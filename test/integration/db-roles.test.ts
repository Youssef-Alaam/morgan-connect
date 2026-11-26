import { sql } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { start } from '../../src/boot.js';
import {
  appendAudit,
  claimTurn,
  createDb,
  createTurnQueue,
  ensureAppRole,
  finishTurn,
  insertTurn,
  migrateToLatest,
  type Db,
} from '../../src/data/index.js';
import { startPostgres, type TestPostgres } from '../helpers/postgres.js';

const PRIVILEGE_ERROR = { code: '42501' };
let postgres: TestPostgres;
let owner: Db;
let app: Db;

/** The container's own connection string with another role in it. */
function asRole(user: string, password: string): string {
  const url = new URL(postgres.url);
  url.username = user;
  url.password = password;
  return url.toString();
}

const APP_URL = (): string => asRole('morgan_app', 'app-pass-1');

beforeAll(async () => {
  postgres = await startPostgres();
  owner = createDb(postgres.url);
  await migrateToLatest(owner);
  await ensureAppRole(owner, APP_URL());
  app = createDb(APP_URL());
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
  const rows = await app.selectFrom('audit_log').select('id').execute();
  expect(rows).toHaveLength(1);
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

it('still runs the normal flows: turns, tables made later, and the queue', async () => {
  const turn = await insertTurn(app, {
    idempotencyKey: 'k1',
    channel: 'fake',
    chatId: 'c1',
    text: 'hi',
  });
  await claimTurn(app, turn.id);
  await finishTurn(app, turn.id, { status: 'done', replyText: 'ok' });
  await app.deleteFrom('chat_messages').execute();

  await sql`create table later_table (id int)`.execute(owner);
  await ensureAppRole(owner, APP_URL());
  await sql`insert into later_table values (1)`.execute(app);

  const queue = createTurnQueue(APP_URL(), () => undefined);
  await queue.start();
  await queue.enqueue(turn.id);
  await queue.stop();
});

it('takes over a queue schema the owner role made first, and follows a new password', async () => {
  const other = await startPostgres();
  const first = createDb(other.url);
  try {
    await migrateToLatest(first);
    const ownerQueue = createTurnQueue(other.url, () => undefined);
    await ownerQueue.start();
    await ownerQueue.stop();
    const url = new URL(other.url);
    url.username = 'morgan_app';
    url.password = 'old-pass';
    await ensureAppRole(first, url.toString());
    url.password = 'new-pass';
    await ensureAppRole(first, url.toString());
    const queue = createTurnQueue(url.toString(), () => undefined);
    await queue.start();
    await queue.stop();
    const stale = createDb(asRoleAt(other.url, 'old-pass'));
    await expect(sql`select 1`.execute(stale)).rejects.toThrow();
    await stale.destroy();
  } finally {
    await first.destroy();
    await other.stop();
  }
});

function asRoleAt(base: string, password: string): string {
  const url = new URL(base);
  url.username = 'morgan_app';
  url.password = password;
  return url.toString();
}

it('refuses to set up the owner role as the app role', async () => {
  await expect(ensureAppRole(owner, postgres.url)).rejects.toThrow('different roles');
});

it('boots with both connection strings and serves as the app role', async () => {
  const running = await start({
    DATABASE_URL: APP_URL(),
    MIGRATION_DATABASE_URL: postgres.url,
    PORT: '0',
    LOG_LEVEL: 'silent',
  });
  try {
    const response = await fetch(`http://127.0.0.1:${String(running.port)}/health`);
    expect(response.status).toBe(200);
  } finally {
    await running.stop();
  }
});
