import {
  claimTurn,
  finishTurn,
  getTurn,
  insertTurn,
  listQueuedTurnIds,
  type Db,
  type Turn,
  type TurnQueue,
} from '../data/index.js';
import type { Identity } from '../identity/index.js';
import type { Logger } from '../ops/index.js';
import { PipelineError } from './errors.js';
import type { TurnAborts } from './aborts.js';
import { isCommand } from './commands.js';
import { admit } from './gate.js';
import { idempotencyKey, parseInbound } from './message.js';
import type { Replier } from './reply.js';
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
  /** Makes the reply text. Without one, the turn echoes its text. */
  reply?: Replier | undefined;
  /** Lets `/stop` abort the running turn of the same chat. */
  aborts?: TurnAborts | undefined;
}

/** An incoming channel payload becomes one turn row and one queued job. Safe to call twice. */
export async function ingest(deps: PipelineDeps, raw: unknown): Promise<void> {
  const where: { channel?: string; turnId?: string } = {};
  try {
    const message = parseInbound(raw);
    where.channel = message.channel;
    if (!(await admit(deps, message))) return;
    if (isCommand(message.text, 'stop')) {
      deps.aborts?.stop(message.channel, message.chatId);
      return;
    }
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

/** Run the replier with an abort signal that `/stop` can fire while the model works. */
async function replyTo(deps: PipelineDeps, turn: Turn, reply: Replier): Promise<string> {
  const signal = deps.aborts?.begin(turn.channel, turn.chatId);
  try {
    return await reply(turn, signal);
  } finally {
    deps.aborts?.end(turn.channel, turn.chatId);
  }
}

/** Run one turn: reply with the model's answer (or echo the text when no model is set). Claimed before the send, so a redelivery never resends. */
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
    if (!(await deps.identity.isLinked(turn.channel, turn.chatId))) {
      throw new PipelineError('unlinked', 'Chat is not linked');
    }
    const sender = deps.senders.find((s) => s.channel === turn.channel);
    if (sender === undefined) throw new PipelineError('unknown_channel', 'No sender for channel');
    const text = deps.reply === undefined ? turn.text : await replyTo(deps, turn, deps.reply);
    await sendWithRetry(() => sender.send(turn.chatId, text), deps.retryDelayMs);
    await finishTurn(deps.db, turnId, { status: 'done', replyText: text });
  } catch (error) {
    const kind = error instanceof PipelineError ? error.kind : 'send_failed';
    await finishTurn(deps.db, turnId, { status: 'failed', error: kind });
    deps.logger.error({ turnId, kind }, 'turn failed');
  }
}

export function startWorker(deps: PipelineDeps): Promise<void> {
  return deps.queue.work((turnId) => processTurn(deps, turnId));
}
