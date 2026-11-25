import { type Kysely, sql } from 'kysely';

/**
 * Every tool call, allowed or refused, once. Append-only: the database refuses to change or
 * remove a row, so a bug in the app cannot rewrite history. Holds argument names and a hash,
 * never argument values.
 *
 * Limit: the triggers guard against app bugs, not a compromised app, because the app's database
 * role can still disable them. Planned: an owner role for migrations and an app role that may
 * only INSERT and SELECT here (docs/adr/0008-audit-log-guards.md).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('audit_log')
    .addColumn('id', 'bigserial', (col) => col.primaryKey())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('turn_id', 'text')
    .addColumn('channel', 'text', (col) => col.notNull())
    .addColumn('chat_id', 'text', (col) => col.notNull())
    .addColumn('user_id', 'uuid')
    .addColumn('tool', 'text', (col) => col.notNull())
    .addColumn('action_type', 'text', (col) => col.notNull())
    .addColumn('changes_state', 'boolean', (col) => col.notNull())
    .addColumn('arg_names', sql`text[]`, (col) => col.notNull())
    .addColumn('extra_args', 'integer', (col) => col.notNull())
    .addColumn('args_sha256', 'text', (col) => col.notNull())
    .addColumn('decision', 'text', (col) =>
      col.notNull().check(sql`decision in ('auto', 'ask', 'off')`),
    )
    .addColumn('outcome', 'text', (col) =>
      col
        .notNull()
        .check(sql`outcome in ('ok', 'error', 'refused', 'denied', 'expired', 'aborted')`),
    )
    .execute();
  await sql`
    create function audit_log_append_only() returns trigger language plpgsql as $$
    begin
      raise exception 'audit_log is append-only';
    end $$`.execute(db);
  await sql`create trigger audit_log_no_change before update or delete on audit_log
    for each row execute function audit_log_append_only()`.execute(db);
  await sql`create trigger audit_log_no_truncate before truncate on audit_log
    for each statement execute function audit_log_append_only()`.execute(db);
}
