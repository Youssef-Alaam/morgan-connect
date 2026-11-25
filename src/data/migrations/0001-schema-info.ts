import { type Kysely, sql } from 'kysely';

/** First migration: a harmless table that proves migrations run from an empty database. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('schema_info')
    .addColumn('key', 'text', (col) => col.primaryKey())
    .addColumn('value', 'text', (col) => col.notNull())
    .execute();
  await sql`insert into schema_info (key, value) values ('created_by', 'M0-4')`.execute(db);
}
