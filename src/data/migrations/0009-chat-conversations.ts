import { type Kysely, sql } from 'kysely';

/** The id of each chat's current conversation. `/new` drops the row, so the next message gets a fresh id. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('chat_conversations')
    .addColumn('channel', 'text', (col) => col.notNull())
    .addColumn('chat_id', 'text', (col) => col.notNull())
    .addColumn('conversation_id', 'uuid', (col) => col.notNull().defaultTo(sql`gen_random_uuid()`))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('chat_conversations_pk', ['channel', 'chat_id'])
    .execute();
}
