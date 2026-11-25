import { type Generated, Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';

export type TurnStatus = 'queued' | 'sending' | 'done' | 'failed';

export interface Database {
  schema_info: { key: string; value: string };
  turns: {
    id: Generated<string>;
    user_id: string | null;
    workspace_id: string | null;
    idempotency_key: string;
    channel: string;
    chat_id: string;
    text: string;
    status: Generated<TurnStatus>;
    reply_text: string | null;
    error: string | null;
    created_at: Generated<Date>;
  };
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
