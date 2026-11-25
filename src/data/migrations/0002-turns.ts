import { type Kysely, sql } from 'kysely';

/**
 * The turn table (M1-1). `user_id` and `workspace_id` stay nullable and unconstrained until the
 * `users` table lands in M1-2; row-level security and isolation tests arrive with them.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('turns')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid')
    .addColumn('workspace_id', 'uuid')
    .addColumn('idempotency_key', 'text', (col) => col.notNull().unique())
    .addColumn('channel', 'text', (col) => col.notNull())
    .addColumn('chat_id', 'text', (col) => col.notNull())
    .addColumn('text', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('queued'))
    .addColumn('reply_text', 'text')
    .addColumn('error', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();
}
