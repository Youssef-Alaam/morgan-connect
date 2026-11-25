import { appendHistory, clearHistory, loadHistory, type Db, type Turn } from '../data/index.js';
import type { Logger } from '../ops/index.js';
import { EngineError, type Engine } from '../policy/index.js';

/** A model error that is only a hiccup is tried again this many times (rule G3 for models). */
const MODEL_RETRIES = 2;
const HISTORY_LIMIT = 40;

export const FAILURE_REPLY = "Sorry, I couldn't get an answer just now. Please try again soon.";
export const STOPPED_REPLY = 'Stopped.';
export const NEW_REPLY = 'Started a new conversation.';

export interface ReplyDeps {
  db: Db;
  engine: Engine;
  logger: Logger;
  system?: string;
  retryDelayMs: number;
  /** The whole answer, retries included, must fit inside the queue's job expiry. */
  turnTimeoutMs: number;
}

/** Turns a stored turn into the text to send back. */
export type Replier = (turn: Turn, signal?: AbortSignal) => Promise<string>;

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

async function ask(deps: ReplyDeps, turn: Turn, signal: AbortSignal): Promise<string> {
  const chat = { channel: turn.channel, chatId: turn.chatId };
  const history = await loadHistory(deps.db, chat, HISTORY_LIMIT);
  for (let attempt = 0; ; attempt += 1) {
    const session = deps.engine.open({
      history,
      ...(deps.system === undefined ? {} : { system: deps.system }),
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
      await wait(deps.retryDelayMs * (attempt + 1));
    } finally {
      signal.removeEventListener('abort', stop);
    }
  }
}

/** Build the replier: `/new` clears the chat; anything else goes to the model with its history. */
export function createReplier(deps: ReplyDeps): Replier {
  return async (turn, signal) => {
    if (turn.text.trim() === '/new') {
      await clearHistory(deps.db, { channel: turn.channel, chatId: turn.chatId });
      return NEW_REPLY;
    }
    const limit = AbortSignal.timeout(deps.turnTimeoutMs);
    const both = AbortSignal.any(signal === undefined ? [limit] : [signal, limit]);
    try {
      return await ask(deps, turn, both);
    } catch (error) {
      const kind = error instanceof EngineError ? error.kind : 'failed';
      deps.logger.warn({ turnId: turn.id, kind }, 'model reply failed');
      return signal?.aborted === true ? STOPPED_REPLY : FAILURE_REPLY;
    }
  };
}
