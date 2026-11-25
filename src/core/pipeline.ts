import {
  claimTurn,
  finishTurn,
  getTurn,
  insertTurn,
  type Db,
  type TurnQueue,
} from '../data/index.js';
import type { Logger } from '../ops/index.js';
import { PipelineError } from './errors.js';
import { idempotencyKey, parseInbound } from './message.js';
import { sendWithRetry } from './retry.js';

/** What the core needs from a channel to deliver a reply. Adapters in `src/channels` fit it. */
export interface ChannelSender {
  readonly channel: string;
  send: (chatId: string, text: string) => Promise<void>;
}

export interface PipelineDeps {
  db: Db;
  queue: TurnQueue;
  senders: readonly ChannelSender[];
  logger: Logger;
  /** Base wait between send retries, in milliseconds. */
  retryDelayMs: number;
}

/** An incoming channel payload becomes one turn row and one queued job. Safe to call twice. */
export async function ingest(deps: PipelineDeps, raw: unknown): Promise<void> {
  const message = parseInbound(raw);
  const turn = await insertTurn(deps.db, {
    idempotencyKey: idempotencyKey(message),
    channel: message.channel,
    chatId: message.chatId,
    text: message.text,
  });
  if (turn.created || turn.status === 'queued') await deps.queue.enqueue(turn.id);
}

/**
 * Run one turn: echo the text back. The turn is claimed (`sending`) before the send, so a
 * crash mid-send is never retried into a double reply: the redelivered job finds the claim,
 * marks the turn failed, and sends nothing.
 */
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
