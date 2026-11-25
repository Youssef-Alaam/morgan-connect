import type { Db } from './db.js';

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface ChatKey {
  channel: string;
  chatId: string;
}

/**
 * The last `limit` messages of a chat that fit in `maxChars`, oldest first. The newest messages
 * are kept, and the list never starts with an answer (a conversation starts with the user).
 */
export async function loadHistory(
  db: Db,
  chat: ChatKey,
  limit: number,
  maxChars: number,
): Promise<ChatMessage[]> {
  const rows = await db
    .selectFrom('chat_messages')
    .select(['role', 'text'])
    .where('channel', '=', chat.channel)
    .where('chat_id', '=', chat.chatId)
    .orderBy('id', 'desc')
    .limit(limit)
    .execute();
  const kept: ChatMessage[] = [];
  let used = 0;
  for (const row of rows) {
    used += row.text.length;
    if (used > maxChars) break;
    kept.unshift(row);
  }
  while (kept[0]?.role === 'assistant') kept.shift();
  return kept;
}

/** Add messages in order, all or none. */
export async function appendHistory(
  db: Db,
  chat: ChatKey,
  messages: readonly ChatMessage[],
): Promise<void> {
  await db
    .insertInto('chat_messages')
    .values(messages.map((m) => ({ channel: chat.channel, chat_id: chat.chatId, ...m })))
    .execute();
}

/** `/new`: forget the conversation in this chat. */
export async function clearHistory(db: Db, chat: ChatKey): Promise<void> {
  await db
    .deleteFrom('chat_messages')
    .where('channel', '=', chat.channel)
    .where('chat_id', '=', chat.chatId)
    .execute();
}
