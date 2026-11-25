import { type Kysely, sql } from 'kysely';

/** What was said in each chat, so the model has the conversation so far (M1-3). */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('chat_messages')
    .addColumn('id', 'bigserial', (col) => col.primaryKey())
    .addColumn('channel', 'text', (col) => col.notNull())
    .addColumn('chat_id', 'text', (col) => col.notNull())
    .addColumn('role', 'text', (col) => col.notNull())
    .addColumn('text', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema
    .createIndex('chat_messages_chat_idx')
    .on('chat_messages')
    .columns(['channel', 'chat_id', 'id'])
    .execute();
}
