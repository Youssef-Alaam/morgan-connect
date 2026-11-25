import {
  claimTurn,
  finishTurn,
  getTurn,
  insertTurn,
  listQueuedTurnIds,
  type Db,
  type TurnQueue,
} from '../data/index.js';
import type { Identity } from '../identity/index.js';
import type { Logger } from '../ops/index.js';
import { PipelineError } from './errors.js';
import { admit } from './gate.js';
import { idempotencyKey, parseInbound } from './message.js';
import { sendWithRetry } from './retry.js';

export interface ChannelSender {
  readonly channel: string;
  send: (chatId: string, text: string) => Promise<void>;
}

export interface PipelineDeps {
  db: Db;
  queue: TurnQueue;
  senders: readonly ChannelSender[];
  logger: Logger;
  retryDelayMs: number;
  identity: Identity;
}

/** An incoming channel payload becomes one turn row and one queued job. Safe to call twice. */
export async function ingest(deps: PipelineDeps, raw: unknown): Promise<void> {
  const where: { channel?: string; turnId?: string } = {};
  try {
    const message = parseInbound(raw);
    where.channel = message.channel;
    if (!(await admit(deps, message))) return;
    const turn = await insertTurn(deps.db, {
      idempotencyKey: idempotencyKey(message),
      channel: message.channel,
      chatId: message.chatId,
      text: message.text,
    });
    where.turnId = turn.id;
    if (turn.created || turn.status === 'queued') await deps.queue.enqueue(turn.id);
  } catch (error) {
    const kind = error instanceof PipelineError ? error.kind : 'ingest_failed';
    deps.logger.error({ ...where, kind }, 'ingest failed');
    throw error;
  }
}

/** Re-queue turns that were stored but never got a job (a crash between insert and enqueue). */
export async function requeueStuckTurns(deps: PipelineDeps): Promise<number> {
  const ids = await listQueuedTurnIds(deps.db);
  for (const id of ids) await deps.queue.enqueue(id);
  return ids.length;
}

/** Run one turn: echo the text back. Claimed before the send, so a redelivery never resends. */
export async function processTurn(deps: PipelineDeps, turnId: string): Promise<void> {
  const turn = await claimTurn(deps.db, turnId);
  if (turn === undefined) {
    const existing = await getTurn(deps.db, turnId);
    if (existing?.status === 'sending') {
      await finishTurn(deps.db, turnId, { status: 'failed', error: 'interrupted' });
      deps.logger.warn({ turnId }, 'turn was interrupted mid-send; not resending');
    }
    return;
  }
  try {
    const sender = deps.senders.find((s) => s.channel === turn.channel);
    if (sender === undefined) throw new PipelineError('unknown_channel', 'No sender for channel');
    await sendWithRetry(() => sender.send(turn.chatId, turn.text), deps.retryDelayMs);
    await finishTurn(deps.db, turnId, { status: 'done', replyText: turn.text });
  } catch (error) {
    const kind = error instanceof PipelineError ? error.kind : 'send_failed';
    await finishTurn(deps.db, turnId, { status: 'failed', error: kind });
    deps.logger.error({ turnId, kind }, 'turn failed');
  }
}

export function startWorker(deps: PipelineDeps): Promise<void> {
  return deps.queue.work((turnId) => processTurn(deps, turnId));
}
