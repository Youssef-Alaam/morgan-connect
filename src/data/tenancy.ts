import type { Db } from './db.js';

/** The workspace every user belongs to until real workspaces land. Same id as migration 0010. */
export const DEFAULT_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';

export interface Owner {
  userId: string;
  workspaceId: string;
}

/** The person (and their workspace) behind a chat, from its linked device; undefined if unlinked. */
export async function ownerOf(
  db: Db,
  chat: { channel: string; chatId: string },
): Promise<Owner | undefined> {
  const row = await db
    .selectFrom('devices')
    .innerJoin('users', 'users.id', 'devices.user_id')
    .select(['users.id as user_id', 'users.workspace_id'])
    .where('devices.channel', '=', chat.channel)
    .where('devices.chat_id', '=', chat.chatId)
    .executeTakeFirst();
  return row === undefined ? undefined : { userId: row.user_id, workspaceId: row.workspace_id };
}

/** Like `ownerOf`, for rows that must belong to someone: an unlinked chat has no data to store. */
export async function requireOwner(
  db: Db,
  chat: { channel: string; chatId: string },
): Promise<Owner> {
  const owner = await ownerOf(db, chat);
  if (owner === undefined) throw new Error('No linked user for this chat');
  return owner;
}
