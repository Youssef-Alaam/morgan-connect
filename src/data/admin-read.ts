import { sql } from 'kysely';
import type { Db, Owner } from './db.js';
import { withOwner } from './tenancy.js';

/**
 * The admin's read path (M2-2, D59): the only way to see another person's rows. Each call runs one
 * database function (migration 0015) that writes the `admin.read` audit row and then returns the
 * rows, in one transaction. Only this module calls those functions, and the app role may execute
 * them by name and nothing else on this path (dependency-cruiser keeps other code from importing it).
 */

/** The app role may execute exactly these (ensureAppRole). */
export const ADMIN_READ_FUNCTIONS: readonly string[] = [
  'admin_read_chat(uuid, uuid, text, integer)',
  'admin_read_usage(uuid, uuid, text, integer)',
];

/** The caller is not an admin, gave no reason, or named someone outside their workspace. Audited. */
export class AdminReadRefused extends Error {
  constructor(
    readonly kind: 'chat' | 'usage',
    readonly memberId: string,
  ) {
    super(`The ${kind} of ${memberId} cannot be read by this person`);
    this.name = 'AdminReadRefused';
  }
}

interface AdminChatMessage {
  id: string;
  channel: string;
  chatId: string;
  role: 'user' | 'assistant' | 'tool' | 'summary';
  text: string;
  data: unknown;
  createdAt: Date;
}

interface AdminUsageRow {
  id: string;
  channel: string;
  chatId: string;
  model: string;
  status: string;
  inputTokens: string;
  outputTokens: string;
  cacheReadTokens: string;
  cacheWriteTokens: string;
  costUsd: string;
  createdAt: Date;
}

/** The newest rows one read returns; a screen that needs more pages through them later. */
const MAX_ROWS = 500;

type Raw = Record<string, unknown>;

async function read(
  db: Db,
  admin: Owner,
  kind: 'chat' | 'usage',
  target: { memberId: string; reason: string },
): Promise<Raw[]> {
  const { memberId, reason } = target;
  const fn = sql.raw(`public.admin_read_${kind}`);
  // The refusal is thrown after the transaction commits, so the audited refusal is kept.
  const result = await withOwner(db, admin, async (trx) => {
    const { rows: out } = await sql<{ rows: Raw[] | null }>`
      select ${fn}(${admin.userId}::uuid, ${memberId}::uuid, ${reason}, ${MAX_ROWS}) as rows`.execute(
      trx,
    );
    return out[0]?.rows ?? null;
  });
  if (result === null) throw new AdminReadRefused(kind, memberId);
  return result;
}

/** A member's chat messages, oldest first (the newest 500), after an audit row says who and why. */
async function chat(
  db: Db,
  admin: Owner,
  memberId: string,
  reason: string,
): Promise<AdminChatMessage[]> {
  const rows = await read(db, admin, 'chat', { memberId, reason });
  return rows.map((r) => ({
    id: String(r['id']),
    channel: String(r['channel']),
    chatId: String(r['chat_id']),
    role: r['role'] as AdminChatMessage['role'],
    text: String(r['text']),
    data: r['data'] ?? null,
    createdAt: new Date(String(r['created_at'])),
  }));
}

/** A member's usage-ledger rows, oldest first (the newest 500), after an audit row. */
async function usage(
  db: Db,
  admin: Owner,
  memberId: string,
  reason: string,
): Promise<AdminUsageRow[]> {
  const rows = await read(db, admin, 'usage', { memberId, reason });
  return rows.map((r) => ({
    id: String(r['id']),
    channel: String(r['channel']),
    chatId: String(r['chat_id']),
    model: String(r['model']),
    status: String(r['status']),
    inputTokens: String(r['input_tokens']),
    outputTokens: String(r['output_tokens']),
    cacheReadTokens: String(r['cache_read_tokens']),
    cacheWriteTokens: String(r['cache_write_tokens']),
    costUsd: String(r['cost_usd']),
    createdAt: new Date(String(r['created_at'])),
  }));
}

export const adminRead = { chat, usage };
