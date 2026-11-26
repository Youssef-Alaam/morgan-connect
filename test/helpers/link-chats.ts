import type { Db } from '../../src/data/index.js';

/**
 * Link chats to one person, so rows written for them have an owner. Reuses the install's admin when
 * one exists (the database allows one), otherwise creates it. Safe to call twice.
 */
export async function linkChats(
  db: Db,
  chatIds: readonly string[],
  channel = 'fake',
): Promise<void> {
  const found = await db.selectFrom('users').select('id').executeTakeFirst();
  const userId =
    found?.id ??
    (
      await db
        .insertInto('users')
        .values({ role: 'admin' })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  if (chatIds.length === 0) return;
  await db
    .insertInto('devices')
    .values(chatIds.map((chatId) => ({ user_id: userId, channel, chat_id: chatId })))
    .onConflict((conflict) => conflict.doNothing())
    .execute();
}
