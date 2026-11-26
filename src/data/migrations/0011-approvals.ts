import { type Kysely, sql } from 'kysely';

/**
 * One row per question "may Morgan do this?" put to the owner (M1-6). It holds a hash of the exact
 * call, never the arguments, and a status that only moves forward: pending, then approved or denied
 * or expired or cancelled, and an approved one ends as used (single use).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('approvals')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (col) => col.notNull())
    .addColumn('workspace_id', 'uuid', (col) => col.notNull())
    .addColumn('channel', 'text', (col) => col.notNull())
    .addColumn('chat_id', 'text', (col) => col.notNull())
    .addColumn('turn_id', 'text')
    .addColumn('tool', 'text', (col) => col.notNull())
    .addColumn('args_sha256', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) =>
      col
        .notNull()
        .defaultTo('pending')
        .check(sql`status in ('pending', 'approved', 'denied', 'expired', 'cancelled', 'used')`),
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('decided_at', 'timestamptz')
    .addForeignKeyConstraint(
      'approvals_user_workspace_fkey',
      ['user_id', 'workspace_id'],
      'users',
      ['id', 'workspace_id'],
    )
    .execute();
}
