import type { Db, TurnStatus } from './db.js';
import { ownerOf } from './tenancy.js';

export interface NewTurn {
  idempotencyKey: string;
  channel: string;
  chatId: string;
  text: string;
}

export interface Turn {
  id: string;
  channel: string;
  chatId: string;
  text: string;
  status: TurnStatus;
  /** Fixed when the turn was stored; everything the turn writes belongs to them. */
  userId: string;
  workspaceId: string;
}

const columns = ['id', 'channel', 'chat_id', 'text', 'status', 'user_id', 'workspace_id'] as const;

function toTurn(row: {
  id: string;
  channel: string;
  chat_id: string;
  text: string;
  status: TurnStatus;
  user_id: string;
  workspace_id: string;
}): Turn {
  return {
    id: row.id,
    channel: row.channel,
    chatId: row.chat_id,
    text: row.text,
    status: row.status,
    userId: row.user_id,
    workspaceId: row.workspace_id,
  };
}

/** Insert a turn; a second insert with the same idempotency key returns the first one. */
export async function insertTurn(
  db: Db,
  turn: NewTurn,
): Promise<{ id: string; status: TurnStatus; created: boolean }> {
  const owner = await ownerOf(db, turn);
  if (owner === undefined) throw new Error('No linked user for this chat');
  const inserted = await db
    .insertInto('turns')
    .values({
      idempotency_key: turn.idempotencyKey,
      channel: turn.channel,
      chat_id: turn.chatId,
      text: turn.text,
      user_id: owner.userId,
      workspace_id: owner.workspaceId,
      reply_text: null,
      error: null,
    })
    .onConflict((oc) => oc.column('idempotency_key').doNothing())
    .returning(['id', 'status'])
    .executeTakeFirst();
  if (inserted !== undefined) return { ...inserted, created: true };
  const existing = await db
    .selectFrom('turns')
    .select(['id', 'status'])
    .where('idempotency_key', '=', turn.idempotencyKey)
    .executeTakeFirstOrThrow();
  return { ...existing, created: false };
}

/** Mark a queued turn as `sending` and return it; undefined if someone already claimed it. */
export async function claimTurn(db: Db, id: string): Promise<Turn | undefined> {
  const row = await db
    .updateTable('turns')
    .set({ status: 'sending' })
    .where('id', '=', id)
    .where('status', '=', 'queued')
    .returning(columns)
    .executeTakeFirst();
  return row === undefined ? undefined : toTurn(row);
}

export async function getTurn(db: Db, id: string): Promise<Turn | undefined> {
  const row = await db.selectFrom('turns').select(columns).where('id', '=', id).executeTakeFirst();
  return row === undefined ? undefined : toTurn(row);
}

/** Turn ids still queued: their job may have been lost between insert and enqueue. */
export async function listQueuedTurnIds(db: Db): Promise<string[]> {
  const rows = await db.selectFrom('turns').select('id').where('status', '=', 'queued').execute();
  return rows.map((row) => row.id);
}

/** Record the outcome. Only a sending turn can finish, so a late writer cannot overwrite. */
export async function finishTurn(
  db: Db,
  id: string,
  result: { status: 'done'; replyText: string } | { status: 'failed'; error: string },
): Promise<void> {
  const fields =
    result.status === 'done'
      ? { status: result.status, reply_text: result.replyText }
      : { status: result.status, error: result.error };
  await db
    .updateTable('turns')
    .set(fields)
    .where('id', '=', id)
    .where('status', '=', 'sending')
    .execute();
}
