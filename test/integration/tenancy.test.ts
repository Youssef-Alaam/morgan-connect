import { sql } from 'kysely';
import { Migrator } from 'kysely/migration';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDb, migrateToLatest, type Db } from '../../src/data/index.js';
import { migrations } from '../../src/data/migrations/index.js';
import { startPostgres, type TestPostgres } from '../helpers/postgres.js';

/** Tables that hold no user data: migration bookkeeping, the install's own setup and identity. */
const SYSTEM_TABLES = [
  'schema_info',
  'kysely_migration',
  'kysely_migration_lock',
  'workspaces',
  'users',
  'devices',
  'setup_codes',
];
/** Tables that must exist and be covered, so renaming one cannot slip past the scan. */
const USER_DATA_TABLES = [
  'turns',
  'chat_messages',
  'chat_conversations',
  'usage_ledger',
  'audit_log',
];
/** `user_id` may be null here: a refused stranger has no user, but the row still has a workspace. */
const NULLABLE_USER_ID = ['audit_log'];

const ADMIN = '00000000-0000-0000-0000-0000000000a1';
const OTHER = '00000000-0000-0000-0000-0000000000a2';
const DEFAULT_WORKSPACE = '00000000-0000-0000-0000-000000000001';

let postgres: TestPostgres;
let db: Db;
let old: Db;

beforeAll(async () => {
  postgres = await startPostgres();
  db = createDb(postgres.url);
  await migrateToLatest(db);
  await sql`create database before_tenancy`.execute(db);
  old = createDb(postgres.url.replace(/\/[^/]*$/, '/before_tenancy'));
}, 180_000);

afterAll(async () => {
  await old.destroy();
  await db.destroy();
  await postgres.stop();
});

it('gives every user-data table user_id and workspace_id', async () => {
  const { rows } = await sql<{ table_name: string; column_name: string; is_nullable: string }>`
    select c.table_name, c.column_name, c.is_nullable
    from information_schema.columns c
    join information_schema.tables t using (table_schema, table_name)
    where c.table_schema = 'public' and t.table_type = 'BASE TABLE'`.execute(db);
  const tables = [...new Set(rows.map((r) => r.table_name))];
  expect(tables).toEqual(expect.arrayContaining(USER_DATA_TABLES));
  const column = (table: string, name: string) =>
    rows.find((r) => r.table_name === table && r.column_name === name);
  for (const table of tables.filter((t) => !SYSTEM_TABLES.includes(t))) {
    expect(column(table, 'workspace_id'), `${table}.workspace_id`).toMatchObject({
      is_nullable: 'NO',
    });
    expect(column(table, 'user_id'), `${table}.user_id`).toMatchObject({
      is_nullable: NULLABLE_USER_ID.includes(table) ? 'YES' : 'NO',
    });
  }
});

it('moves existing rows into the default workspace under their chat owner', async () => {
  const before = Object.fromEntries(Object.entries(migrations).filter(([name]) => name < '0010'));
  const migrator = (all: typeof migrations) =>
    new Migrator({ db: old, provider: { getMigrations: () => Promise.resolve(all) } });
  expect((await migrator(before).migrateToLatest()).error).toBeUndefined();
  await sql`insert into users (id, role) values (${ADMIN}, 'admin'), (${OTHER}, 'member')`.execute(
    old,
  );
  await sql`insert into devices (user_id, channel, chat_id) values (${OTHER}, 'fake', 'other'), (${ADMIN}, 'fake', 'mine')`.execute(
    old,
  );
  await sql`insert into turns (idempotency_key, channel, chat_id, text) values ('a', 'fake', 'other', 'x'), ('b', 'fake', 'orphan', 'y')`.execute(
    old,
  );
  await sql`insert into chat_messages (channel, chat_id, role, text) values ('fake', 'other', 'user', 'x')`.execute(
    old,
  );
  await sql`insert into usage_ledger (channel, chat_id, model, status, input_tokens, output_tokens, cost_usd) values ('fake', 'mine', 'm', 'ok', 1, 1, 0)`.execute(
    old,
  );
  await sql`insert into chat_conversations (channel, chat_id) values ('fake', 'mine')`.execute(old);
  await sql`insert into audit_log (channel, chat_id, tool, action_type, changes_state, arg_names, extra_args, args_sha256, decision, outcome) values ('fake', 'stranger', 't', 'read', false, '{}', 0, 'h', 'auto', 'ok')`.execute(
    old,
  );

  expect((await migrator(migrations).migrateToLatest()).error).toBeUndefined();

  const turns =
    await sql`select chat_id, user_id, workspace_id from turns order by chat_id`.execute(old);
  expect(turns.rows).toEqual([
    { chat_id: 'orphan', user_id: ADMIN, workspace_id: DEFAULT_WORKSPACE },
    { chat_id: 'other', user_id: OTHER, workspace_id: DEFAULT_WORKSPACE },
  ]);
  const owners = await sql<{ user_id: string; workspace_id: string }>`
    select user_id, workspace_id from chat_messages
    union all select user_id, workspace_id from usage_ledger
    union all select user_id, workspace_id from chat_conversations`.execute(old);
  expect(owners.rows.map((r) => r.user_id)).toEqual([OTHER, ADMIN, ADMIN]);
  expect(owners.rows.every((r) => r.workspace_id === DEFAULT_WORKSPACE)).toBe(true);
  const audit = await sql`select user_id, workspace_id from audit_log`.execute(old);
  expect(audit.rows).toEqual([{ user_id: null, workspace_id: DEFAULT_WORKSPACE }]);
  const users = await sql<{ workspace_id: string }>`select workspace_id from users`.execute(old);
  expect(users.rows.every((r) => r.workspace_id === DEFAULT_WORKSPACE)).toBe(true);
});

it('refuses a row with no user or no workspace', async () => {
  await expect(
    sql`insert into chat_messages (channel, chat_id, role, text) values ('f', 'c', 'user', 'x')`.execute(
      db,
    ),
  ).rejects.toThrow();
});

it('refuses a row whose user belongs to another workspace', async () => {
  await sql`insert into workspaces (id, name) values ('00000000-0000-0000-0000-0000000000f2', 'Other')`.execute(
    db,
  );
  await sql`insert into users (id, role) values ('00000000-0000-0000-0000-0000000000f1', 'member')`.execute(
    db,
  );
  await expect(
    sql`insert into chat_messages (user_id, workspace_id, channel, chat_id, role, text)
      values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2', 'f', 'c', 'user', 'x')`.execute(
      db,
    ),
  ).rejects.toThrow();
});

it('says what is wrong when old rows have no owner to take', async () => {
  await sql`create database no_admin`.execute(db);
  const bare = createDb(postgres.url.replace(/\/[^/]*$/, '/no_admin'));
  try {
    const before = Object.fromEntries(Object.entries(migrations).filter(([name]) => name < '0010'));
    const run = (all: typeof migrations) =>
      new Migrator({ db: bare, provider: { getMigrations: () => Promise.resolve(all) } });
    expect((await run(before).migrateToLatest()).error).toBeUndefined();
    await sql`insert into turns (idempotency_key, channel, chat_id, text) values ('a', 'f', 'c', 'x')`.execute(
      bare,
    );
    expect((await run(migrations).migrateToLatest()).error).toMatchObject({
      message: expect.stringContaining('no linked device and no admin') as string,
    });
  } finally {
    await bare.destroy();
  }
});
