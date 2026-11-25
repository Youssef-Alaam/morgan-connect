import type { ChatKey } from './history.js';
import type { Db } from './db.js';

/** The id of this chat's current conversation. It stays the same until `/new`. */
export async function conversationFor(db: Db, chat: ChatKey): Promise<string> {
  await db
    .insertInto('chat_conversations')
    .values({ channel: chat.channel, chat_id: chat.chatId })
    .onConflict((conflict) => conflict.columns(['channel', 'chat_id']).doNothing())
    .execute();
  const row = await db
    .selectFrom('chat_conversations')
    .select('conversation_id')
    .where('channel', '=', chat.channel)
    .where('chat_id', '=', chat.chatId)
    .executeTakeFirstOrThrow();
  return row.conversation_id;
}

/** `/new`: finish the current conversation. Returns its id, or undefined when none was started. */
export async function endConversation(db: Db, chat: ChatKey): Promise<string | undefined> {
  const row = await db
    .deleteFrom('chat_conversations')
    .where('channel', '=', chat.channel)
    .where('chat_id', '=', chat.chatId)
    .returning('conversation_id')
    .executeTakeFirst();
  return row?.conversation_id;
}
