import {
  appendHistory,
  clearHistory,
  closeStoppedTurn,
  conversationFor,
  endConversation,
  lastMessageAt,
  loadHistory,
  recordUsage,
  usageSince,
  type Db,
  type Turn,
} from '../data/index.js';
import { formatLocalTime, type Logger } from '../ops/index.js';
import {
  EngineError,
  type Caller,
  type Engine,
  type EngineCallUsage,
  type EngineSession,
  type Gate,
} from '../policy/index.js';
import { joinSystem, trusted, type SystemPrompt } from '../safety/index.js';
import { withSwitchedOffNote } from './switched-off.js';
import { refusedForBudget, type BudgetSettings, type ReplyResult } from './budget-reply.js';
import { compact, type BeforeCompact } from './compaction.js';
import { isCommand } from './commands.js';
import { toEngineHistory } from './summary-view.js';
import type { ChannelSender } from './sender.js';
import { formatUsage } from './usage-report.js';

/** A model error that is only a hiccup is tried again this many times (rule G3 for models). */
const MODEL_RETRIES = 2;
/** How many past user turns (with their tool calls) the model is shown. */
const HISTORY_TURNS = 20;
/** About 6k tokens of past conversation; older messages are left out first. */
const HISTORY_CHARS = 24_000;

export const FAILURE_REPLY = "Sorry, I couldn't get an answer just now. Please try again soon.";
export const STOPPED_REPLY = 'Stopped.';
export const NEW_REPLY = 'Started a new conversation.';
export const IDLE_REPLY = 'It has been a while, so I started a new conversation.';

export interface ReplyDeps {
  db: Db;
  engine: Engine;
  logger: Logger;
  /** Instruction text: a trusted literal only. */
  system?: SystemPrompt;
  /** The tools the model may call, each behind the policy gate. */
  gate?: Gate;
  /**
   * Spend limits (M2-10a). Unset: no limit is checked. Checked here in core, once at the start of each turn, not in the policy gate (which only
   * guards tools). Compaction calls are not checked. M2-10b builds on this.
   */
  budget?: BudgetSettings;
  /** The model id the engine uses; written to the usage ledger. */
  model: string;
  /** Where "today" starts for /usage, and the zone of the time shown to the model (an IANA name). */
  timezone: string;
  /** The clock; tests fix it. */
  now?: () => Date;
  retryDelayMs: number;
  typingIntervalMs: number;
  /** The whole answer, retries included, must fit inside the queue's job expiry. */
  turnTimeoutMs: number;
  /** After this long without a message the next one starts a new conversation. Unset: never. */
  idleGapMs?: number;
  /** When one model call carries this many tokens, the older part of the chat is summarised. Unset: never. */
  compactAtTokens?: number;
  /** Runs before old messages are replaced by a summary. Does nothing in M2. */
  beforeCompact?: BeforeCompact;
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

/** Turns a stored turn into the reply to send back. */
export type Replier = (
  turn: Turn,
  sender: ChannelSender,
  signal?: AbortSignal,
) => Promise<ReplyResult>;

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
      userId: turn.userId,
      workspaceId: turn.workspaceId,
      model: deps.model,
      status: status === 'aborted' && timedOut() ? 'timeout' : status,
      ...used,
    });
  } catch {
    deps.logger.warn({ turnId: turn.id }, 'usage not recorded');
  }
}

/** Whose data a turn writes: the person stored on the turn, never looked up again. */
const owner = (turn: Turn) => ({ userId: turn.userId, workspaceId: turn.workspaceId });

/** Remember a turn that stopped after it began using tools, so the model knows what it did. */
async function keepStopped(
  deps: ReplyDeps,
  turn: Turn,
  done: Parameters<typeof closeStoppedTurn>[0],
): Promise<void> {
  if (!done.some((m) => m.role !== 'user')) return;
  try {
    await appendHistory(
      deps.db,
      { channel: turn.channel, chatId: turn.chatId },
      closeStoppedTurn(done),
      owner(turn),
    );
  } catch {
    deps.logger.warn({ turnId: turn.id }, 'stopped turn not remembered');
  }
}

const TIME_NOTE = trusted('The current local time is given at the start of each user message.');

const LANGUAGE_NOTE = trusted(
  "Reply in the language of the person's latest message; commands and fixed bot lines stay in English.",
);

/** The system prompt never changes between turns, so the provider can cache it. */
const systemFor = (deps: ReplyDeps): SystemPrompt =>
  joinSystem(...(deps.system === undefined ? [] : [deps.system]), TIME_NOTE, LANGUAGE_NOTE);

/** "[Now: Wed 25 Nov 2026 13:30 (Africa/Cairo, UTC+02:00)] hello": kept in the history, so each turn keeps its own time. */
function stamped(deps: ReplyDeps, text: string): string {
  const date = (deps.now ?? (() => new Date()))();
  let when: string;
  try {
    when = formatLocalTime(date, deps.timezone);
  } catch {
    when = formatLocalTime(date, 'UTC');
  }
  return `[Now: ${when}] ${text}`;
}

/**
 * After a failed prompt: wait and say true when another try is worth it. Otherwise remember what
 * happened so far and say false. A hiccup is retried only while no tool has run, because a tool
 * may have changed something.
 */
async function shouldRetry(
  deps: ReplyDeps,
  turn: Turn,
  session: EngineSession,
  failure: { error: unknown; attempt: number; signal: AbortSignal },
): Promise<boolean> {
  const { error, attempt, signal } = failure;
  const done = session.transcript();
  const kind = error instanceof EngineError ? error.kind : 'failed';
  if (kind === 'transient' && attempt < MODEL_RETRIES && !done.some((m) => m.role === 'tool')) {
    await wait(deps.retryDelayMs * (attempt + 1), signal);
    return !signal.aborted;
  }
  await keepStopped(deps, turn, done);
  return false;
}

/** At turn start: when the chat has been quiet for the idle gap, start over as `/new` does. True if it did. */
async function startOverWhenIdle(deps: ReplyDeps, turn: Turn): Promise<boolean> {
  if (deps.idleGapMs === undefined) return false;
  const last = await lastMessageAt(deps.db, owner(turn), {
    channel: turn.channel,
    chatId: turn.chatId,
  });
  const now = (deps.now ?? (() => new Date()))();
  if (last === undefined || now.getTime() - last.getTime() <= deps.idleGapMs) return false;
  await startOver(deps, turn);
  return true;
}

/** How full the context was: the tokens one model call carried. */
const contextOf = (call: EngineCallUsage): number =>
  call.inputTokens + call.cacheReadTokens + call.cacheWriteTokens;

async function ask(
  deps: ReplyDeps,
  turn: Turn,
  signal: AbortSignal,
  timedOut: () => boolean,
): Promise<{ answer: string; context: number }> {
  const chat = { channel: turn.channel, chatId: turn.chatId };
  const history = await loadHistory(deps.db, owner(turn), chat, {
    turns: HISTORY_TURNS,
    maxChars: HISTORY_CHARS,
  });
  const conversationId = await conversationFor(deps.db, chat, owner(turn));
  let context = 0;
  for (let attempt = 0; ; attempt += 1) {
    const pending: Promise<void>[] = [];
    const session = deps.engine.open({
      history: toEngineHistory(history),
      conversationId,
      onUsage: (call) => {
        context = Math.max(context, contextOf(call));
        pending.push(recordCall(deps, turn, call, timedOut));
      },
      system: systemFor(deps),
      ...gateOptions(deps.gate, { ...chat, turnId: turn.id }),
    });
    const stop = (): void => {
      session.abort();
    };
    signal.addEventListener('abort', stop);
    if (signal.aborted) stop();
    let answered = false;
    try {
      const answer = await session.prompt(stamped(deps, turn.text));
      answered = true;
      await appendHistory(deps.db, chat, session.transcript(), owner(turn));
      return { answer, context };
    } catch (error) {
      if (answered || !(await shouldRetry(deps, turn, session, { error, attempt, signal })))
        throw error;
    } finally {
      signal.removeEventListener('abort', stop);
      await Promise.all(pending);
    }
  }
}

/** After the answer is stored: when the context got this big, replace the older part with a summary. A failure here never costs the answer. */
async function compactWhenFull(
  deps: ReplyDeps,
  turn: Turn,
  context: number,
  { signal, timedOut }: { signal: AbortSignal; timedOut: () => boolean },
): Promise<void> {
  if (deps.compactAtTokens === undefined || context < deps.compactAtTokens) return;
  const pending: Promise<void>[] = [];
  try {
    await compact({
      db: deps.db,
      engine: deps.engine,
      owner: owner(turn),
      chat: { channel: turn.channel, chatId: turn.chatId },
      thresholdTokens: deps.compactAtTokens,
      signal,
      onUsage: (call) => pending.push(recordCall(deps, turn, call, timedOut)),
      beforeCompact: deps.beforeCompact,
    });
  } catch {
    deps.logger.warn({ turnId: turn.id }, 'history not compacted');
  } finally {
    await Promise.all(pending);
  }
}

/** `/new`: forget the chat and end the engine conversation; an engine failure never blocks it. */
async function startOver(deps: ReplyDeps, turn: Turn): Promise<void> {
  const chat = { channel: turn.channel, chatId: turn.chatId };
  const ended = await endConversation(deps.db, owner(turn), chat);
  await clearHistory(deps.db, owner(turn), chat);
  if (ended === undefined || deps.engine.end === undefined) return;
  try {
    await deps.engine.end(ended);
  } catch {
    deps.logger.warn({ turnId: turn.id }, 'engine did not close the conversation');
  }
}

/** Build the replier: `/new` clears the chat, `/usage` shows spend; anything else goes to the model with its history. */
export function createReplier(deps: ReplyDeps): Replier {
  return async (turn, sender, signal) => {
    if (isCommand(turn.text, 'new')) {
      await startOver(deps, turn);
      return NEW_REPLY;
    }
    if (isCommand(turn.text, 'usage')) {
      return formatUsage(
        await usageSince(deps.db, owner(turn), new Date(), deps.timezone),
        deps.timezone,
      );
    }
    const limit = AbortSignal.timeout(deps.turnTimeoutMs);
    const both = AbortSignal.any(signal === undefined ? [limit] : [signal, limit]);
    const stopTyping = keepTyping(deps, turn, sender);
    try {
      const refused = await refusedForBudget(deps, turn);
      if (refused !== undefined) return refused;
      const renewed = await startOverWhenIdle(deps, turn);
      const timedOut = (): boolean => limit.aborted && signal?.aborted !== true;
      const { answer, context } = await ask(deps, turn, both, timedOut);
      await compactWhenFull(deps, turn, context, { signal: both, timedOut });
      const told = withSwitchedOffNote(deps.gate, turn.id, answer);
      return renewed
        ? `${IDLE_REPLY}

${told}`
        : told;
    } catch (error) {
      const kind = error instanceof EngineError ? error.kind : 'failed';
      deps.logger.warn({ turnId: turn.id, kind }, 'model reply failed');
      return signal?.aborted === true ? STOPPED_REPLY : FAILURE_REPLY;
    } finally {
      deps.gate?.takeSwitchedOff(turn.id);
      stopTyping();
    }
  };
}
