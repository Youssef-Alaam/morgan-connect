import { type ColumnType, type Generated, Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';

export type AuditOutcome = 'ok' | 'error' | 'refused' | 'denied' | 'expired' | 'aborted';
export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'cancelled' | 'used';
export type TurnStatus = 'queued' | 'sending' | 'done' | 'failed';

export interface Database {
  schema_info: { key: string; value: string };
  turns: {
    id: Generated<string>;
    user_id: string;
    workspace_id: string;
    idempotency_key: string;
    channel: string;
    chat_id: string;
    text: string;
    status: Generated<TurnStatus>;
    reply_text: string | null;
    error: string | null;
    created_at: Generated<Date>;
  };
  workspaces: { id: Generated<string>; name: string; created_at: Generated<Date> };
  users: {
    id: Generated<string>;
    role: Generated<string>;
    workspace_id: Generated<string>;
    told_admin_can_read_at: Date | null;
    monthly_limit_usd: string | null;
    created_at: Generated<Date>;
  };
  devices: {
    id: Generated<string>;
    user_id: string;
    channel: string;
    chat_id: string;
    created_at: Generated<Date>;
  };
  credentials: {
    user_id: string;
    workspace_id: string;
    email: string;
    password_hash: string;
    must_change: Generated<boolean>;
    created_at: Generated<Date>;
  };
  invites: {
    id: Generated<string>;
    user_id: string;
    workspace_id: string;
    token_hash: string;
    role: string;
    monthly_limit_usd: string | null;
    created_at: Generated<Date>;
    expires_at: Date;
    used_at: Date | null;
  };
  link_codes: {
    id: Generated<string>;
    user_id: string;
    workspace_id: string;
    code_hash: string;
    created_at: Generated<Date>;
    expires_at: Date;
    used_at: Date | null;
  };
  sessions: {
    id: Generated<string>;
    user_id: string;
    workspace_id: string;
    token_hash: string;
    created_at: Generated<Date>;
    expires_at: Date;
  };
  password_links: {
    id: Generated<string>;
    user_id: string;
    workspace_id: string;
    token_hash: string;
    created_at: Generated<Date>;
    expires_at: Date;
    used_at: Date | null;
  };
  totp_factors: {
    user_id: string;
    workspace_id: string;
    secret_sealed: string;
    confirmed_at: Date | null;
    // bigint comes back from pg as a string.
    last_step: ColumnType<string, number | undefined, number>;
    created_at: Generated<Date>;
  };
  backup_codes: {
    id: Generated<string>;
    user_id: string;
    workspace_id: string;
    code_hash: string;
    created_at: Generated<Date>;
    used_at: Date | null;
  };
  passkeys: {
    id: Generated<string>;
    user_id: string;
    workspace_id: string;
    credential_id: string;
    public_key: string;
    // bigint comes back from pg as a string.
    counter: ColumnType<string, number | undefined, number>;
    transports: string[] | null;
    name: string;
    created_at: Generated<Date>;
    last_used_at: Date | null;
  };
  setup_codes: {
    id: Generated<string>;
    code_hash: string;
    created_at: Generated<Date>;
    claimed_at: Date | null;
  };
  chat_messages: {
    id: Generated<string>;
    user_id: string;
    workspace_id: string;
    channel: string;
    chat_id: string;
    role: 'user' | 'assistant' | 'tool' | 'summary';
    text: string;
    /** Tool calls (assistant) or the tool result details (tool); null for plain text. */
    data: ColumnType<unknown, string | null | undefined, string | null>;
    /** On a `summary` row: the first and last message id it replaced. Null otherwise. */
    covers_from: Generated<string | null>;
    covers_to: Generated<string | null>;
    created_at: Generated<Date>;
  };
  chat_conversations: {
    user_id: string;
    workspace_id: string;
    channel: string;
    chat_id: string;
    conversation_id: Generated<string>;
    created_at: Generated<Date>;
  };
  audit_log: {
    id: Generated<string>;
    created_at: Generated<Date>;
    turn_id: string | null;
    channel: string;
    chat_id: string;
    user_id: string | null;
    workspace_id: string;
    tool: string;
    action_type: string;
    changes_state: boolean;
    arg_names: string[];
    extra_args: number;
    args_sha256: string;
    decision: 'auto' | 'ask' | 'off';
    outcome: AuditOutcome;
    /** For an admin read: whose rows were read, and why. Null on every other row. */
    subject_user_id: string | null;
    reason: string | null;
  };
  approvals: {
    id: Generated<string>;
    user_id: string;
    workspace_id: string;
    channel: string;
    chat_id: string;
    turn_id: string | null;
    tool: string;
    args_sha256: string;
    status: Generated<ApprovalStatus>;
    created_at: Generated<Date>;
    expires_at: Date;
    decided_at: Date | null;
  };
  web_events: {
    id: Generated<string>;
    user_id: string;
    workspace_id: string;
    chat_id: string;
    kind: 'ack' | 'message';
    ref: string | null;
    text: Generated<string>;
    created_at: Generated<Date>;
  };
  usage_ledger: {
    id: Generated<string>;
    user_id: string;
    workspace_id: string;
    channel: string;
    chat_id: string;
    model: string;
    status: UsageStatus;
    // bigint and numeric come back from pg as strings.
    input_tokens: ColumnType<string, number, never>;
    output_tokens: ColumnType<string, number, never>;
    cache_read_tokens: ColumnType<string, number, never>;
    cache_write_tokens: ColumnType<string, number, never>;
    cost_usd: ColumnType<string, string, never>;
    created_at: Generated<Date>;
  };
}

export type UsageStatus = 'ok' | 'failed' | 'aborted' | 'timeout';

export type Db = Kysely<Database>;

/** The person a query runs as: the user and their workspace. */
export interface Owner {
  userId: string;
  workspaceId: string;
}

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
