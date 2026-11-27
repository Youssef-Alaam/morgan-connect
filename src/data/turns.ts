import { sql } from 'kysely';
import type { Db, TurnStatus } from './db.js';
import { queuedTurnIds } from './system.js';
import { DEFAULT_TASK_CAP } from './task-cap.js';
import { type Owner, ownerOf, withOwner } from './tenancy.js';

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
  return withOwner(db, owner, async (trx) => {
    const inserted = await trx
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
    const existing = await trx
      .selectFrom('turns')
      .select(['id', 'status'])
      .where('idempotency_key', '=', turn.idempotencyKey)
      .executeTakeFirstOrThrow();
    return { ...existing, created: false };
  });
}

/** First key of the advisory lock that serialises one person's claims; the second is the person. */
const TASK_CAP_LOCK = 0x4d43;

/** The person's cap, read in SQL so it sits in the same statement as the count it limits. */
const capSql = sql<number>`coalesce((select u.max_parallel_tasks from users u
  where u.id = nullif(current_setting('app.user_id', true), '')::uuid), ${DEFAULT_TASK_CAP}::int)`;

/**
 * Turns that run before this one may: the person's sending turns, plus their queued turns that
 * arrived earlier (so the line keeps its order). Both counts name the person, so they hold even where row-level security is off.
 */
const aheadSql = sql<number>`(select count(*) from turns r where r.status = 'sending'
     and r.user_id = turns.user_id and r.id <> turns.id)
  + (select count(*) from turns q where q.status = 'queued' and q.user_id = turns.user_id
     and (q.created_at, q.id) < (turns.created_at, turns.id))`;

/**
 * Mark a queued turn as `sending` and return it; undefined if someone already claimed it or the
 * person is at their parallel-task cap (the turn then stays queued: see `getTurn`). The count
 * is Postgres-side and runs under a per-person advisory lock, so any number of stateless workers
 * agree on it; the lock is held only for this short transaction.
 */
export async function claimTurn(db: Db, owner: Owner, id: string): Promise<Turn | undefined> {
  const row = await withOwner(db, owner, async (trx) => {
    await sql`select pg_advisory_xact_lock(${TASK_CAP_LOCK}::int, hashtext(${owner.userId}))`.execute(
      trx,
    );
    return trx
      .updateTable('turns')
      .set({ status: 'sending', claimed_at: sql`now()` })
      .where('id', '=', id)
      .where('status', '=', 'queued')
      .where(sql<boolean>`${aheadSql} < ${capSql}`)
      .returning(columns)
      .executeTakeFirst();
  });
  return row === undefined ? undefined : toTurn(row);
}

/**
 * Mark a turn failed as interrupted, but only if a worker claimed it more than `olderThanSeconds`
 * ago. A newer claim is a live run that a duplicate job must not touch. True when it was marked.
 */
export function interruptTurn(
  db: Db,
  owner: Owner,
  id: string,
  olderThanSeconds: number,
): Promise<boolean> {
  return withOwner(db, owner, async (trx) => {
    const rows = await trx
      .updateTable('turns')
      .set({ status: 'failed', error: 'interrupted' })
      .where('id', '=', id)
      .where('status', '=', 'sending')
      .where(sql<boolean>`claimed_at <= now() - make_interval(secs => ${olderThanSeconds})`)
      .returning('id')
      .execute();
    return rows.length > 0;
  });
}

/** How many tasks are ahead of a just-queued turn, and the cap; used to tell the person they wait. */
export function waitingBehind(
  db: Db,
  owner: Owner,
  id: string,
): Promise<{ ahead: number; cap: number }> {
  return withOwner(db, owner, async (trx) => {
    const { rows } = await sql<{ ahead: string; cap: number }>`
      select ${aheadSql} as ahead, ${capSql} as cap from turns where id = ${id}::uuid`.execute(trx);
    return { ahead: Number(rows[0]?.ahead ?? 0), cap: rows[0]?.cap ?? DEFAULT_TASK_CAP };
  });
}

export async function getTurn(db: Db, owner: Owner, id: string): Promise<Turn | undefined> {
  const row = await withOwner(db, owner, (trx) =>
    trx.selectFrom('turns').select(columns).where('id', '=', id).executeTakeFirst(),
  );
  return row === undefined ? undefined : toTurn(row);
}

/** Turn ids still queued, for everyone: their job may have been lost between insert and enqueue. */
export function listQueuedTurnIds(db: Db): Promise<string[]> {
  return queuedTurnIds(db);
}

/** Record the outcome. Only a sending turn can finish, so a late writer cannot overwrite. */
export async function finishTurn(
  db: Db,
  owner: Owner,
  id: string,
  result: { status: 'done'; replyText: string } | { status: 'failed'; error: string },
): Promise<void> {
  const fields =
    result.status === 'done'
      ? { status: result.status, reply_text: result.replyText }
      : { status: result.status, error: result.error };
  await withOwner(db, owner, (trx) =>
    trx
      .updateTable('turns')
      .set(fields)
      .where('id', '=', id)
      .where('status', '=', 'sending')
      .execute(),
  );
}
