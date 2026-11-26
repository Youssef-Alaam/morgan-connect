import { type Kysely, sql } from 'kysely';

/**
 * Row-level security as the second lock (M2-1a). Every user-data table shows and accepts only the
 * rows of the person set on the transaction (`withOwner`); with nobody set, the setting is empty,
 * the comparison is null, and no row matches. FORCE applies the rules to the table owner too, and
 * the app role owns nothing and has NOBYPASSRLS. Lookups before a person is known go through the
 * named functions of migration 0012, never through a looser policy.
 */
const ME = sql`nullif(current_setting('app.user_id', true), '')::uuid`;
const WS = sql`nullif(current_setting('app.workspace_id', true), '')::uuid`;
const OWNED = ['turns', 'chat_messages', 'chat_conversations', 'usage_ledger', 'approvals'];

async function lock(db: Kysely<unknown>, table: string): Promise<void> {
  await sql`alter table ${sql.table(table)} enable row level security`.execute(db);
  await sql`alter table ${sql.table(table)} force row level security`.execute(db);
}

export async function up(db: Kysely<unknown>): Promise<void> {
  for (const table of OWNED) {
    await lock(db, table);
    await sql`create policy own_rows on ${sql.table(table)}
      using (user_id = ${ME} and workspace_id = ${WS})
      with check (user_id = ${ME} and workspace_id = ${WS})`.execute(db);
  }
  // A person sees their own user row and their own devices, nothing about anyone else.
  await lock(db, 'users');
  await sql`create policy own_rows on users
    using (id = ${ME} and workspace_id = ${WS})
    with check (id = ${ME} and workspace_id = ${WS})`.execute(db);
  await lock(db, 'devices');
  // devices has no workspace column: the users subquery runs under users' own policy, so it adds
  // "and the device's user is in the set workspace".
  await sql`create policy own_rows on devices
    using (user_id = ${ME} and exists (select 1 from users u where u.id = devices.user_id))
    with check (user_id = ${ME} and exists (select 1 from users u where u.id = devices.user_id))`.execute(
    db,
  );
  // Read only your own audit rows. A stranger's row (no person) may still be written.
  await lock(db, 'audit_log');
  await sql`create policy own_rows on audit_log for select
    using (user_id = ${ME} and workspace_id = ${WS})`.execute(db);
  await sql`create policy append_own_or_stranger on audit_log for insert
    with check (user_id is null or (user_id = ${ME} and workspace_id = ${WS}))`.execute(db);
}
