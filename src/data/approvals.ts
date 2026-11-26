import type { Db } from './db.js';
import type { Owner } from './tenancy.js';

export interface NewApproval {
  owner: Owner;
  channel: string;
  chatId: string;
  turnId?: string | undefined;
  tool: string;
  /** Fingerprint of the exact call; the arguments themselves are not stored. */
  argsSha256: string;
  expiresAt: Date;
}

/** Open a question to the owner. Returns its id. */
export async function createApproval(db: Db, approval: NewApproval): Promise<string> {
  const row = await db
    .insertInto('approvals')
    .values({
      user_id: approval.owner.userId,
      workspace_id: approval.owner.workspaceId,
      channel: approval.channel,
      chat_id: approval.chatId,
      turn_id: approval.turnId ?? null,
      tool: approval.tool,
      args_sha256: approval.argsSha256,
      expires_at: approval.expiresAt,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/**
 * Record the owner's answer. True only if it was still pending and unexpired, and came from the
 * chat the question was sent to, which must still be the owner's linked device. One step, so two
 * taps cannot both win.
 */
export async function decideApproval(
  db: Db,
  answer: {
    id: string;
    decision: 'approved' | 'denied';
    channel: string;
    chatId: string;
    now: Date;
  },
): Promise<boolean> {
  const row = await db
    .updateTable('approvals')
    .set({ status: answer.decision, decided_at: answer.now })
    .where('id', '=', answer.id)
    .where('status', '=', 'pending')
    .where('expires_at', '>', answer.now)
    .where('channel', '=', answer.channel)
    .where('chat_id', '=', answer.chatId)
    .where('user_id', 'in', (eb) =>
      eb
        .selectFrom('devices')
        .select('devices.user_id')
        .where('devices.channel', '=', answer.channel)
        .where('devices.chat_id', '=', answer.chatId),
    )
    .returning('id')
    .executeTakeFirst();
  return row !== undefined;
}

/** Spend an approval on exactly this call. True once: it must be approved, unexpired, and match the hash. */
export async function consumeApproval(
  db: Db,
  use: { id: string; argsSha256: string; now: Date },
): Promise<boolean> {
  const row = await db
    .updateTable('approvals')
    .set({ status: 'used' })
    .where('id', '=', use.id)
    .where('status', '=', 'approved')
    .where('args_sha256', '=', use.argsSha256)
    .where('expires_at', '>', use.now)
    .returning('id')
    .executeTakeFirst();
  return row !== undefined;
}

/** End a question nobody answered in time (`expired`) or that the turn gave up on (`cancelled`). */
export async function closeApproval(
  db: Db,
  id: string,
  status: 'expired' | 'cancelled',
): Promise<boolean> {
  const row = await db
    .updateTable('approvals')
    .set({ status })
    .where('id', '=', id)
    .where('status', 'in', ['pending', 'approved'])
    .returning('id')
    .executeTakeFirst();
  return row !== undefined;
}

/** At startup no turn is waiting any more, so every open question is over. Returns how many. */
export async function closeOrphanedApprovals(db: Db): Promise<number> {
  const rows = await db
    .updateTable('approvals')
    .set({ status: 'expired' })
    .where('status', 'in', ['pending', 'approved'])
    .returning('id')
    .execute();
  return rows.length;
}
