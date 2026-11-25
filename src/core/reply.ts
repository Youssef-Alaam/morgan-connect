import {
  appendHistory,
  clearHistory,
  loadHistory,
  recordUsage,
  type Db,
  type Turn,
} from '../data/index.js';
import type { Logger } from '../ops/index.js';
import {
  EngineError,
  type Caller,
  type Engine,
  type EngineCallUsage,
  type Gate,
} from '../policy/index.js';
import { isCommand } from './commands.js';
import type { ChannelSender } from './sender.js';

/** A model error that is only a hiccup is tried again this many times (rule G3 for models). */
const MODEL_RETRIES = 2;
const HISTORY_LIMIT = 40;
/** About 6k tokens of past conversation; older messages are left out first. */
const HISTORY_CHARS = 24_000;

export const FAILURE_REPLY = "Sorry, I couldn't get an answer just now. Please try again soon.";
export const STOPPED_REPLY = 'Stopped.';
export const NEW_REPLY = 'Started a new conversation.';

export interface ReplyDeps {
  db: Db;
  engine: Engine;
  logger: Logger;
  system?: string;
  /** The tools the model may call, each behind the policy gate. */
  gate?: Gate;
  /** The model id the engine uses; written to the usage ledger. */
  model: string;
  retryDelayMs: number;
  typingIntervalMs: number;
  /** The whole answer, retries included, must fit inside the queue's job expiry. */
  turnTimeoutMs: number;
}

/** The time limit plus the waits before model retries must end before the queue gives up the job. */
export function assertFitsJobExpiry(
  timing: Pick<ReplyDeps, 'turnTimeoutMs' | 'retryDelayMs'>,
  expireSeconds: number,
): void {
  const waits = timing.retryDelayMs * ((MODEL_RETRIES * (MODEL_RETRIES + 1)) / 2);
  if (timing.turnTimeoutMs + waits >= expireSeconds * 1000) {
    throw new Error('The turn time limit does not fit inside the queue job expiry');
  }
}

/** Turns a stored turn into the text to send back. */
export type Replier = (turn: Turn, sender: ChannelSender, signal?: AbortSignal) => Promise<string>;

/** Wait, but wake at once when the turn is aborted. */
const wait = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done);
  });

/** Keep the "typing" signal alive while the model thinks. Returns the stop function. */
function keepTyping(deps: ReplyDeps, turn: Turn, sender: ChannelSender): () => void {
  if (sender.typing === undefined) return () => undefined;
  const ping = (): void => {
    sender.typing?.(turn.chatId).catch(() => {
      deps.logger.warn({ turnId: turn.id }, 'typing indicator failed');
    });
  };
  ping();
  const timer = setInterval(ping, deps.typingIntervalMs);
  return () => {
    clearInterval(timer);
  };
}

function gateOptions(
  gate: Gate | undefined,
  caller: Caller,
): Partial<Parameters<Engine['open']>[0]> {
  if (gate === undefined) return {};
  return { tools: gate.toolsFor(caller), unknownTool: gate.unknownTool(caller) };
}

/**
 * One ledger row per model call. A call that never reached the provider (nothing billed, nothing
 * counted) is not a call, so it gets no row. A ledger failure never costs the owner the answer.
 */
async function recordCall(
  deps: ReplyDeps,
  turn: Turn,
  call: EngineCallUsage,
  timedOut: () => boolean,
): Promise<void> {
  const { status, ...used } = call;
  const sent = used.inputTokens + used.outputTokens + used.cacheReadTokens + used.cacheWriteTokens;
  if (sent === 0 && used.costUsd === 0) return;
  try {
    await recordUsage(deps.db, {
      channel: turn.channel,
      chatId: turn.chatId,
      model: deps.model,
      status: status === 'aborted' && timedOut() ? 'timeout' : status,
      ...used,
    });
  } catch {
    deps.logger.warn({ turnId: turn.id }, 'usage not recorded');
  }
}

async function ask(
  deps: ReplyDeps,
  turn: Turn,
  signal: AbortSignal,
  timedOut: () => boolean,
): Promise<string> {
  const chat = { channel: turn.channel, chatId: turn.chatId };
  const history = await loadHistory(deps.db, chat, HISTORY_LIMIT, HISTORY_CHARS);
  for (let attempt = 0; ; attempt += 1) {
    const pending: Promise<void>[] = [];
    const session = deps.engine.open({
      history,
      onUsage: (call) => pending.push(recordCall(deps, turn, call, timedOut)),
      ...(deps.system === undefined ? {} : { system: deps.system }),
      ...gateOptions(deps.gate, { ...chat, turnId: turn.id }),
    });
    const stop = (): void => {
      session.abort();
    };
    signal.addEventListener('abort', stop);
    if (signal.aborted) stop();
    try {
      const answer = await session.prompt(turn.text);
      await appendHistory(deps.db, chat, [
        { role: 'user', text: turn.text },
        { role: 'assistant', text: answer },
      ]);
      return answer;
    } catch (error) {
      const kind = error instanceof EngineError ? error.kind : 'failed';
      if (kind !== 'transient' || attempt >= MODEL_RETRIES) throw error;
      await wait(deps.retryDelayMs * (attempt + 1), signal);
      if (signal.aborted) throw error;
    } finally {
      signal.removeEventListener('abort', stop);
      await Promise.all(pending);
    }
  }
}

/** Build the replier: `/new` clears the chat; anything else goes to the model with its history. */
export function createReplier(deps: ReplyDeps): Replier {
  return async (turn, sender, signal) => {
    if (isCommand(turn.text, 'new')) {
      await clearHistory(deps.db, { channel: turn.channel, chatId: turn.chatId });
      return NEW_REPLY;
    }
    const limit = AbortSignal.timeout(deps.turnTimeoutMs);
    const both = AbortSignal.any(signal === undefined ? [limit] : [signal, limit]);
    const stopTyping = keepTyping(deps, turn, sender);
    try {
      return await ask(deps, turn, both, () => limit.aborted && signal?.aborted !== true);
    } catch (error) {
      const kind = error instanceof EngineError ? error.kind : 'failed';
      deps.logger.warn({ turnId: turn.id, kind }, 'model reply failed');
      return signal?.aborted === true ? STOPPED_REPLY : FAILURE_REPLY;
    } finally {
      stopTyping();
    }
  };
}
