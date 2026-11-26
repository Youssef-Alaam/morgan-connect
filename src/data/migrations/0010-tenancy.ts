import { type Kysely, sql } from 'kysely';

/**
 * Every table with user data carries `user_id` and `workspace_id` (ADR-0002, STANDARDS section 6).
 * One default workspace exists until real workspaces land; every user belongs to it. Old rows get
 * the person from the linked device of their chat (the admin when no device matches). Audit rows
 * keep a nullable `user_id` with no foreign key: a refused stranger has no user, and the history
 * must outlive a removed user.
 */
const DEFAULT_WORKSPACE = '00000000-0000-0000-0000-000000000001';
const WITH_USER = ['turns', 'chat_messages', 'usage_ledger', 'chat_conversations'] as const;

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('workspaces')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();
  await sql`insert into workspaces (id, name) values (${DEFAULT_WORKSPACE}, 'Default')`.execute(db);

  // Existing rows take the default workspace; the default is then dropped so a writer cannot forget it.
  await sql`alter table users add column workspace_id uuid not null
    default ${sql.lit(DEFAULT_WORKSPACE)} references workspaces (id)`.execute(db);
  for (const table of ['chat_messages', 'usage_ledger', 'chat_conversations', 'audit_log']) {
    await sql`alter table ${sql.table(table)} add column workspace_id uuid
      not null default ${sql.lit(DEFAULT_WORKSPACE)} references workspaces (id)`.execute(db);
    await sql`alter table ${sql.table(table)} alter column workspace_id drop default`.execute(db);
  }
  // `turns` has had both columns since M1-1, empty so far.
  await sql`update turns set workspace_id = ${DEFAULT_WORKSPACE} where workspace_id is null`.execute(
    db,
  );
  await sql`alter table turns alter column workspace_id set not null`.execute(db);
  await sql`alter table turns add foreign key (workspace_id) references workspaces (id)`.execute(
    db,
  );

  await sql`update turns set user_id = coalesce(
    (select d.user_id from devices d where d.channel = turns.channel and d.chat_id = turns.chat_id),
    (select u.id from users u where u.role = 'admin')) where user_id is null`.execute(db);
  for (const table of ['chat_messages', 'usage_ledger', 'chat_conversations'] as const) {
    await sql`alter table ${sql.table(table)} add column user_id uuid references users (id)`.execute(
      db,
    );
    await sql`update ${sql.table(table)} t set user_id = coalesce(
      (select d.user_id from devices d where d.channel = t.channel and d.chat_id = t.chat_id),
      (select u.id from users u where u.role = 'admin')) where t.user_id is null`.execute(db);
  }
  await sql`alter table turns add foreign key (user_id) references users (id)`.execute(db);
  for (const table of WITH_USER) {
    await sql`alter table ${sql.table(table)} alter column user_id set not null`.execute(db);
  }
}
