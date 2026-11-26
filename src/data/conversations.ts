import type { ChatKey } from './history.js';
import type { Db } from './db.js';
import { type Owner, withOwner } from './tenancy.js';

/** The id of this chat's current conversation. It stays the same until `/new`. */
export function conversationFor(db: Db, chat: ChatKey, owner: Owner): Promise<string> {
  return withOwner(db, owner, async (trx) => {
    await trx
      .insertInto('chat_conversations')
      .values({
        user_id: owner.userId,
        workspace_id: owner.workspaceId,
        channel: chat.channel,
        chat_id: chat.chatId,
      })
      .onConflict((conflict) => conflict.columns(['channel', 'chat_id']).doNothing())
      .execute();
    const row = await trx
      .selectFrom('chat_conversations')
      .select('conversation_id')
      .where('channel', '=', chat.channel)
      .where('chat_id', '=', chat.chatId)
      .executeTakeFirstOrThrow();
    return row.conversation_id;
  });
}

/** `/new`: finish the current conversation. Returns its id, or undefined when none was started. */
export async function endConversation(
  db: Db,
  owner: Owner,
  chat: ChatKey,
): Promise<string | undefined> {
  const row = await withOwner(db, owner, (trx) =>
    trx
      .deleteFrom('chat_conversations')
      .where('channel', '=', chat.channel)
      .where('chat_id', '=', chat.chatId)
      .returning('conversation_id')
      .executeTakeFirst(),
  );
  return row?.conversation_id;
}
