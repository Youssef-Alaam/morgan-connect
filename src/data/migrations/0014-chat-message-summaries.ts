import type { Kysely } from 'kysely';

/**
 * A compaction (M2-3b) stores its summary as a `chat_messages` row with role `summary`. The two
 * columns say which message ids it replaced. The replaced rows stay; they are only left out of
 * what the model is shown. Both are null on every other row.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('chat_messages')
    .addColumn('covers_from', 'bigint')
    .addColumn('covers_to', 'bigint')
    .execute();
}
