import { clearHistory, endConversation, type Db, type Turn } from '../data/index.js';
import type { Logger } from '../ops/index.js';
import type { Engine } from '../policy/index.js';

/** `/new`: forget the chat and end the engine conversation; an engine failure never blocks it. */
export async function startOver(
  deps: { db: Db; engine: Engine; logger: Logger },
  turn: Turn,
): Promise<void> {
  const owner = { userId: turn.userId, workspaceId: turn.workspaceId };
  const chat = { channel: turn.channel, chatId: turn.chatId };
  const ended = await endConversation(deps.db, owner, chat);
  await clearHistory(deps.db, owner, chat);
  if (ended === undefined || deps.engine.end === undefined) return;
  try {
    await deps.engine.end(ended);
  } catch {
    deps.logger.warn({ turnId: turn.id }, 'engine did not close the conversation');
  }
}
