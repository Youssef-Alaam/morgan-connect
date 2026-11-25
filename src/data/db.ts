import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';

export interface Database {
  schema_info: { key: string; value: string };
}

export type Db = Kysely<Database>;

export function createDb(databaseUrl: string): Db {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}

/** The Postgres server version, e.g. "17.6". Also proves the database answers. */
export async function dbVersion(db: Db): Promise<string> {
  const { rows } = await sql<{
    version: string;
  }>`select current_setting('server_version') as version`.execute(db);
  const row = rows[0];
  if (row === undefined) throw new Error('Postgres returned no server version');
  return row.version;
}
