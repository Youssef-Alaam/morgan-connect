import { type Kysely, sql } from 'kysely';

/**
 * Who may talk to the install (M1-2). A device is a linked chat identity. The setup code is
 * kept only as a hash. These are install-wide tables, so they carry no `user_id` filter.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('users')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('role', 'text', (col) => col.notNull().defaultTo('admin'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema
    .createTable('devices')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id'))
    .addColumn('channel', 'text', (col) => col.notNull())
    .addColumn('chat_id', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('devices_channel_chat_unique', ['channel', 'chat_id'])
    .execute();
  await db.schema
    .createTable('setup_codes')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('code_hash', 'text', (col) => col.notNull().unique())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('claimed_at', 'timestamptz')
    .execute();
}
