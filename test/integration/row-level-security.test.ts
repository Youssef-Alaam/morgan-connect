import { sql } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  appendHistory,
  createDb,
  ensureAppRole,
  migrateToLatest,
  ownerOf,
  recordUsage,
  withOwner,
  type Db,
  type Owner,
} from '../../src/data/index.js';
import { RLS_EXEMPT_SCHEMAS, RLS_EXEMPT_TABLES } from '../../src/data/rls.js';
import { linkChats } from '../helpers/link-chats.js';
import { startPostgres, type TestPostgres } from '../helpers/postgres.js';

const USER_TABLES = ['turns', 'chat_messages', 'chat_conversations', 'usage_ledger'] as const;
let postgres: TestPostgres;
let owner: Db;
let app: Db;
let alice: Owner;
let bob: Owner;

/** One row in each user-data table for this person, written as the owner role. */
async function seed(who: Owner, chatId: string): Promise<void> {
  const chat = { channel: 'fake', chatId };
  const ids = {
    user_id: who.userId,
    workspace_id: who.workspaceId,
    channel: 'fake',
    chat_id: chatId,
  };
  await owner
    .insertInto('turns')
    .values({ ...ids, idempotency_key: chatId, text: 'x', reply_text: null, error: null })
    .execute();
  await appendHistory(owner, chat, [{ role: 'user', text: 'hi' }], who);
  await owner.insertInto('chat_conversations').values(ids).execute();
  await recordUsage(owner, {
    ...who,
    ...chat,
    model: 'm',
    status: 'ok',
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
  });
}

beforeAll(async () => {
  postgres = await startPostgres();
  owner = createDb(postgres.url);
  await migrateToLatest(owner);
  alice = await linkChats(owner, ['a']);
  const member = await owner
    .insertInto('users')
    .values({ role: 'member' })
    .returning(['id', 'workspace_id'])
    .executeTakeFirstOrThrow();
  bob = { userId: member.id, workspaceId: member.workspace_id };
  await owner
    .insertInto('devices')
    .values({ user_id: bob.userId, channel: 'fake', chat_id: 'b' })
    .execute();
  await seed(alice, 'a');
  await seed(bob, 'b');
  const url = new URL(postgres.url);
  url.username = 'morgan_app';
  url.password = 'app-pass-rls';
  await ensureAppRole(owner, url.toString());
  app = createDb(url.toString());
}, 180_000);

afterAll(async () => {
  await app.destroy();
  await owner.destroy();
  await postgres.stop();
});

const userIds = async (db: Db, table: string): Promise<string[]> =>
  (await sql<{ user_id: string }>`select user_id from ${sql.table(table)}`.execute(db)).rows.map(
    (r) => r.user_id,
  );

it.each(USER_TABLES)('shows the app role only the set person’s rows in %s', async (table) => {
  const seen = await withOwner(app, alice, (trx) => userIds(trx, table));
  expect(seen.length).toBeGreaterThan(0);
  expect(new Set(seen)).toEqual(new Set([alice.userId]));
});

it.each([...USER_TABLES, 'users', 'devices', 'approvals', 'audit_log'])(
  'shows no rows of %s when no person is set (fail closed)',
  async (table) => {
    const { rows } = await sql<{
      n: string;
    }>`select count(*) as n from ${sql.table(table)}`.execute(app);
    expect(rows[0]?.n).toBe('0');
  },
);

it('refuses an insert carrying another person�s user_id', async () => {
  const write = withOwner(app, alice, (trx) =>
    trx
      .insertInto('chat_messages')
      .values({
        user_id: bob.userId,
        workspace_id: bob.workspaceId,
        channel: 'fake',
        chat_id: 'a',
        role: 'user',
        text: 'x',
        data: null,
      })
      .execute(),
  );
  await expect(write).rejects.toThrow('row-level security');
});

it('lets a person see only their own user row and devices', async () => {
  const users = await withOwner(app, bob, (trx) => trx.selectFrom('users').select('id').execute());
  expect(users).toEqual([{ id: bob.userId }]);
  const devices = await withOwner(app, bob, (trx) =>
    trx.selectFrom('devices').select('chat_id').execute(),
  );
  expect(devices).toEqual([{ chat_id: 'b' }]);
});

it('answers the unknown-sender lookup for one exact chat only', async () => {
  expect(await ownerOf(app, { channel: 'fake', chatId: 'b' })).toEqual(bob);
  expect(await ownerOf(app, { channel: 'fake', chatId: 'stranger' })).toBeUndefined();
});

it('gives the app role no way to switch the rules off', async () => {
  await expect(
    app.transaction().execute(async (trx) => {
      await sql`set local row_security = off`.execute(trx);
      await sql`select 1 from chat_messages`.execute(trx);
    }),
  ).rejects.toThrow('row-level security');
  await expect(
    sql`alter table chat_messages disable row level security`.execute(app),
  ).rejects.toThrow('must be owner');
});

it('has every table under forced row-level security with a policy, or on the exempt list', async () => {
  const { rows } = await sql<{
    schema: string;
    name: string;
    rls: boolean;
    forced: boolean;
    policies: number;
  }>`
    select n.nspname as schema, c.relname as name, c.relrowsecurity as rls,
      c.relforcerowsecurity as forced,
      (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and n.nspname not in ('pg_catalog', 'information_schema')
      and n.nspname not like 'pg_toast%'`.execute(owner);
  const unlocked = rows
    .filter((r) => !RLS_EXEMPT_SCHEMAS.includes(r.schema) && !RLS_EXEMPT_TABLES.includes(r.name))
    .filter((r) => r.schema !== 'public' || !r.rls || !r.forced || r.policies === 0)
    .map((r) => `${r.schema}.${r.name}`);
  expect(unlocked).toEqual([]);
  expect(rows.filter((r) => r.schema === 'public' && r.rls).length).toBeGreaterThanOrEqual(8);
});
