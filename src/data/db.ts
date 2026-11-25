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
  users: { id: Generated<string>; role: Generated<string>; created_at: Generated<Date> };
  devices: {
    id: Generated<string>;
    user_id: string;
    channel: string;
    chat_id: string;
    created_at: Generated<Date>;
  };
  setup_codes: {
    id: Generated<string>;
    code_hash: string;
    created_at: Generated<Date>;
    claimed_at: Date | null;
  };
  chat_messages: {
    id: Generated<string>;
    channel: string;
    chat_id: string;
    role: 'user' | 'assistant';
    text: string;
    created_at: Generated<Date>;
  };
  audit_log: {
    id: Generated<string>;
    created_at: Generated<Date>;
    turn_id: string | null;
    channel: string;
    chat_id: string;
    user_id: string | null;
    tool: string;
    action_type: string;
    changes_state: boolean;
    arg_names: string[];
    decision: 'auto' | 'ask' | 'off';
    outcome: 'ok' | 'error' | 'refused';
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
