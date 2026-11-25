import type { Db } from './db.js';

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface ChatKey {
  channel: string;
  chatId: string;
}

/** The last `limit` messages of a chat, oldest first. */
export async function loadHistory(db: Db, chat: ChatKey, limit: number): Promise<ChatMessage[]> {
  const rows = await db
    .selectFrom('chat_messages')
    .select(['role', 'text'])
    .where('channel', '=', chat.channel)
    .where('chat_id', '=', chat.chatId)
    .orderBy('id', 'desc')
    .limit(limit)
    .execute();
  return rows.reverse();
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
