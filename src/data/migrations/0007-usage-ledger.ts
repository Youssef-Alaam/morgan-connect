import { type Kysely, sql } from 'kysely';

/** One row per model call that was sent (status: ok, failed, aborted by the owner, or timeout): what the engine reported as used (M1-4). */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('usage_ledger')
    .addColumn('id', 'bigserial', (col) => col.primaryKey())
    .addColumn('channel', 'text', (col) => col.notNull())
    .addColumn('chat_id', 'text', (col) => col.notNull())
    .addColumn('model', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('input_tokens', 'bigint', (col) => col.notNull())
    .addColumn('output_tokens', 'bigint', (col) => col.notNull())
    .addColumn('cache_read_tokens', 'bigint', (col) => col.notNull().defaultTo(0))
    .addColumn('cache_write_tokens', 'bigint', (col) => col.notNull().defaultTo(0))
    .addColumn('cost_usd', sql`numeric(14, 8)`, (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema
    .createIndex('usage_ledger_created_idx')
    .on('usage_ledger')
    .column('created_at')
    .execute();
}
