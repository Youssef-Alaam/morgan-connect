import {
  claimTurn,
  expireStaleTurns,
  finishTurn,
  getTurn,
  interruptTurn,
  insertTurn,
  ownerOf,
  listQueuedTurnIds,
  turnOwner,
  waitingBehind,
  type Db,
  type Owner,
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
import type { ReplyResult } from './budget-reply.js';
import type { Replier } from './reply.js';
import { sendWithRetry } from './retry.js';
import type { ChannelSender } from './sender.js';

export type { ChannelSender } from './sender.js';

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
    // A device removed since admit leaves nobody to own the turn: treat it as not admitted.
    const owner = await ownerOf(deps.db, message);
    if (owner === undefined) return;
    const turn = await insertTurn(deps.db, {
      idempotencyKey: idempotencyKey(message),
      channel: message.channel,
      chatId: message.chatId,
      text: message.text,
    });
    where.turnId = turn.id;
    if (turn.created || turn.status === 'queued') await deps.queue.enqueue(turn.id);
    if (turn.created) await tellIfWaiting(deps, message, owner, turn.id);
  } catch (error) {
    const kind = error instanceof PipelineError ? error.kind : 'ingest_failed';
    deps.logger.error({ ...where, kind }, 'ingest failed');
    throw error;
  }
}

/** A turn that cannot start yet (its person is at their cap) gets one line saying so. */
async function tellIfWaiting(
  deps: PipelineDeps,
  chat: { channel: string; chatId: string },
  owner: Owner,
  turnId: string,
): Promise<void> {
  try {
    const sender = deps.senders.find((s) => s.channel === chat.channel);
    if (sender === undefined) return;
    const { ahead, cap } = await waitingBehind(deps.db, owner, turnId);
    if (ahead < cap) return;
    const others = ahead === 1 ? '1 other task' : `${String(ahead)} other tasks`;
    await sender.send(chat.chatId, `Queued behind ${others}. I will start it when one finishes.`);
  } catch (error) {
    // The notice is a courtesy: the turn is already stored and queued.
    deps.logger.warn(
      { turnId, kind: error instanceof Error ? error.name : 'unknown' },
      'queue notice failed',
    );
  }
}

/**
 * Clean up after a dead worker, then re-queue turns that were stored but never got a job (a crash
 * between insert and enqueue). A turn claimed longer ago than the job expiry is failed, which frees
 * its person's slot; returns how many turns were re-queued.
 */
export async function requeueStuckTurns(deps: PipelineDeps): Promise<number> {
  await expireStaleTurns(deps.db, deps.queue.expireInSeconds);
  const ids = await listQueuedTurnIds(deps.db);
  for (const id of ids) await deps.queue.enqueue(id);
  return ids.length;
}

/**
 * Re-queue stuck turns now and then, so a queued turn that lost its job cannot hold up its
 * person's line. Safe to repeat: a turn has one waiting job. Returns the stop function.
 */
export function watchStuckTurns(deps: PipelineDeps, everyMs: number): () => void {
  let busy = false;
  const timer = setInterval(() => {
    // A slow sweep is not overlapped by the next tick.
    if (busy) return;
    busy = true;
    requeueStuckTurns(deps)
      .catch((error: unknown) => {
        deps.logger.warn(
          { kind: error instanceof Error ? error.name : 'unknown' },
          'requeue failed',
        );
      })
      .finally(() => {
        busy = false;
      });
  }, everyMs);
  return () => {
    clearInterval(timer);
  };
}

/** Run the replier with an abort signal that `/stop` can fire while the model works. */
async function replyTo(
  deps: PipelineDeps,
  turn: Turn,
  sender: ChannelSender,
  reply: Replier,
): Promise<ReplyResult> {
  const signal = deps.aborts?.begin(turn.channel, turn.chatId);
  try {
    return await reply(turn, sender, signal);
  } finally {
    deps.aborts?.end(turn.channel, turn.chatId);
  }
}

/** Send the reply, with its button when it has one and the channel can show it. Returns the text sent. */
async function deliver(
  deps: PipelineDeps,
  chatId: string,
  sender: ChannelSender,
  reply: ReplyResult,
): Promise<string> {
  const text = typeof reply === 'string' ? reply : reply.text;
  const send =
    typeof reply !== 'string' && sender.askMore !== undefined
      ? sender.askMore.bind(sender)
      : sender.send.bind(sender);
  await sendWithRetry(() => send(chatId, text), deps.retryDelayMs);
  return text;
}

/** A job whose turn could not be claimed: interrupted by a crash, already done, or held by the cap. */
async function unclaimed(
  deps: PipelineDeps,
  owner: Owner,
  turnId: string,
): Promise<'later' | undefined> {
  const existing = await getTurn(deps.db, owner, turnId);
  // Only a claim older than the job's expiry is dead; a newer one is a live run seen by a duplicate job.
  if (
    existing?.status === 'sending' &&
    (await interruptTurn(deps.db, owner, turnId, deps.queue.expireInSeconds))
  ) {
    deps.logger.warn({ turnId }, 'turn was interrupted mid-send; not resending');
  }
  // Still queued after a failed claim: the person is at their cap. Keep it, and look again later.
  return existing?.status === 'queued' ? 'later' : undefined;
}

/** Run one turn: reply with the model's answer (or echo the text when no model is set). Claimed before the send, so a redelivery never resends. */
export async function processTurn(
  deps: PipelineDeps,
  turnId: string,
): Promise<'later' | undefined> {
  // The job holds only the id: find whose turn it is, then do everything else as them.
  const owner = await turnOwner(deps.db, turnId);
  if (owner === undefined) return undefined;
  const turn = await claimTurn(deps.db, owner, turnId);
  if (turn === undefined) return unclaimed(deps, owner, turnId);
  try {
    if (!(await deps.identity.isLinked(turn.channel, turn.chatId))) {
      throw new PipelineError('unlinked', 'Chat is not linked');
    }
    const sender = deps.senders.find((s) => s.channel === turn.channel);
    if (sender === undefined) throw new PipelineError('unknown_channel', 'No sender for channel');
    const reply =
      deps.reply === undefined ? turn.text : await replyTo(deps, turn, sender, deps.reply);
    const text = await deliver(deps, turn.chatId, sender, reply);
    await finishTurn(deps.db, owner, turnId, { status: 'done', replyText: text });
  } catch (error) {
    const kind = error instanceof PipelineError ? error.kind : 'send_failed';
    await finishTurn(deps.db, owner, turnId, { status: 'failed', error: kind });
    deps.logger.error({ turnId, kind }, 'turn failed');
  }
  return undefined;
}

export function startWorker(deps: PipelineDeps): Promise<void> {
  return deps.queue.work((turnId) => processTurn(deps, turnId));
}
