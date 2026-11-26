import type { Db, Owner } from '../../src/data/index.js';

/**
 * Link chats to one person, so rows written for them have an owner. Reuses the install's admin when
 * one exists (the database allows one), otherwise creates it. Safe to call twice.
 */
export async function linkChats(
  db: Db,
  chatIds: readonly string[],
  channel = 'fake',
): Promise<Owner> {
  const found = await db.selectFrom('users').select(['id', 'workspace_id']).executeTakeFirst();
  const user =
    found ??
    (await db
      .insertInto('users')
      .values({ role: 'admin' })
      .returning(['id', 'workspace_id'])
      .executeTakeFirstOrThrow());
  if (chatIds.length > 0) {
    await db
      .insertInto('devices')
      .values(chatIds.map((chatId) => ({ user_id: user.id, channel, chat_id: chatId })))
      .onConflict((conflict) => conflict.doNothing())
      .execute();
  }
  return { userId: user.id, workspaceId: user.workspace_id };
}
