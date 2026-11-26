import { sql } from 'kysely';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { start } from '../../src/boot.js';
import {
  appendAudit,
  claimTurn,
  createDb,
  createTurnQueue,
  ensureAppRole,
  finishTurn,
  installQueueSchema,
  insertTurn,
  migrateToLatest,
  type Db,
  type Owner,
  withOwner,
} from '../../src/data/index.js';
import { linkChats } from '../helpers/link-chats.js';
import { startFakeTelegram } from '../helpers/fake-telegram.js';
import { startPostgres, type TestPostgres } from '../helpers/postgres.js';

const PRIVILEGE_ERROR = { code: '42501' };
let postgres: TestPostgres;
let owner: Db;
let app: Db;
let who: Owner;

/** A connection string to the given container as the app role. */
function appUrl(container: TestPostgres = postgres, password = 'app-pass-1'): string {
  const url = new URL(container.url);
  url.username = 'morgan_app';
  url.password = password;
  return url.toString();
}

beforeAll(async () => {
  postgres = await startPostgres();
  owner = createDb(postgres.url);
  await migrateToLatest(owner);
  who = await linkChats(owner, ['c1']);
  await ensureAppRole(owner, appUrl());
  app = createDb(appUrl());
});

afterAll(async () => {
  await app.destroy();
  await owner.destroy();
  await postgres.stop();
});

const entry = (): Parameters<typeof appendAudit>[1] => ({
  channel: 'fake',
  chatId: 'c1',
  tool: 'clock.now',
  actionType: 'read',
  changesState: false,
  argNames: [],
  extraArgs: 0,
  argsSha256: 'a'.repeat(64),
  decision: 'auto',
  outcome: 'ok',
});

it('lets the app role add and read audit rows', async () => {
  await appendAudit(app, entry());
  const rows = await withOwner(app, who, (trx) =>
    trx.selectFrom('audit_log').select('id').execute(),
  );
  expect(rows).toHaveLength(1);
  // Under row-level security, nobody set means no rows.
  expect(await app.selectFrom('audit_log').select('id').execute()).toHaveLength(0);
});

it('refuses UPDATE, DELETE and TRUNCATE on audit_log on privilege, not on the trigger', async () => {
  await expect(sql`update audit_log set tool = 'x'`.execute(app)).rejects.toMatchObject(
    PRIVILEGE_ERROR,
  );
  await expect(sql`delete from audit_log`.execute(app)).rejects.toMatchObject(PRIVILEGE_ERROR);
  await expect(sql`truncate audit_log`.execute(app)).rejects.toMatchObject(PRIVILEGE_ERROR);
});

it('cannot switch the audit triggers off or drop the table', async () => {
  const off = sql`alter table audit_log disable trigger all`;
  await expect(off.execute(app)).rejects.toThrow('must be owner');
  await expect(sql`drop table audit_log`.execute(app)).rejects.toThrow('must be owner');
});

it('still runs the normal flows: turns and tables made later', async () => {
  const turn = await insertTurn(app, {
    idempotencyKey: 'k1',
    channel: 'fake',
    chatId: 'c1',
    text: 'hi',
  });
  await claimTurn(app, who, turn.id);
  await finishTurn(app, who, turn.id, { status: 'done', replyText: 'ok' });
  await app.deleteFrom('chat_messages').execute();

  await sql`create table later_table (id int)`.execute(owner);
  await ensureAppRole(owner, appUrl());
  await sql`insert into later_table values (1)`.execute(app);
});

it('cannot write the migration books', async () => {
  await sql`select * from schema_info`.execute(app);
  await expect(sql`delete from schema_info`.execute(app)).rejects.toMatchObject(PRIVILEGE_ERROR);
  await expect(sql`delete from kysely_migration`.execute(app)).rejects.toMatchObject(
    PRIVILEGE_ERROR,
  );
});

it('cannot make a decoy schema, so a rerun still guards public.audit_log', async () => {
  const decoy = sql`create schema morgan`;
  await expect(decoy.execute(app)).rejects.toMatchObject(PRIVILEGE_ERROR);
  await sql`create schema decoy`.execute(owner);
  await sql`create table decoy.audit_log (id int)`.execute(owner);
  await ensureAppRole(owner, appUrl());
  await expect(sql`update public.audit_log set tool = 'x'`.execute(app)).rejects.toMatchObject(
    PRIVILEGE_ERROR,
  );
});

it('runs the queue as the app role in a schema the owner installed, and follows a new password', async () => {
  const other = await startPostgres();
  const first = createDb(other.url);
  try {
    await migrateToLatest(first);
    await installQueueSchema(other.url);
    await ensureAppRole(first, appUrl(other, 'old-pass'));
    await ensureAppRole(first, appUrl(other, 'new-pass'));
    const queue = createTurnQueue(appUrl(other, 'new-pass'), () => undefined, undefined, {
      schemaInstalled: true,
    });
    await queue.start();
    await queue.enqueue('00000000-0000-0000-0000-000000000001');
    await queue.stop();
    const stale = createDb(appUrl(other, 'old-pass'));
    await expect(sql`select 1`.execute(stale)).rejects.toThrow();
    await stale.destroy();
  } finally {
    await first.destroy();
    await other.stop();
  }
});

it('refuses to set up the owner role as the app role', async () => {
  await expect(ensureAppRole(owner, postgres.url)).rejects.toThrow('different roles');
});

it('boots with both connection strings and answers a Telegram message as the app role', async () => {
  await linkChats(owner, ['42'], 'telegram');
  const telegram = await startFakeTelegram({ rejectToken: false });
  const running = await start({
    DATABASE_URL: appUrl(),
    MIGRATION_DATABASE_URL: postgres.url,
    PORT: '0',
    TELEGRAM_BOT_TOKEN: '123:fake-token',
    TELEGRAM_API_ROOT: telegram.apiRoot,
    LOG_LEVEL: 'silent',
  });
  try {
    await vi.waitFor(
      () => {
        expect(telegram.sent).toMatchObject([{ chat_id: '42', text: 'ping' }]);
      },
      { timeout: 30_000 },
    );
  } finally {
    await running.stop();
    await telegram.stop();
  }
});
