import { sql } from 'kysely';
import type { Db, Owner } from './db.js';
import { withOwner } from './tenancy.js';

/** The device paths (migration 0019); the app role may execute exactly these by name. */
export const DEVICE_FUNCTIONS: readonly string[] = [
  'system_redeem_link_code(text, text, text)',
  'member_unlink_device(uuid)',
];

const UNIQUE_VIOLATION = '23505';

/** Make a link code for this person (only its hash is stored); their older unused codes go. */
export function issueLinkCode(
  db: Db,
  owner: Owner,
  code: { codeHash: string; ttlSeconds: number },
): Promise<void> {
  return withOwner(db, owner, async (trx) => {
    await trx.deleteFrom('link_codes').where('used_at', 'is', null).execute();
    await trx
      .insertInto('link_codes')
      .values({
        user_id: owner.userId,
        workspace_id: owner.workspaceId,
        code_hash: code.codeHash,
        expires_at: sql<Date>`now() + make_interval(secs => ${code.ttlSeconds}::integer)`,
      })
      .execute();
  });
}

/**
 * Spend a code and link this chat to the person who asked for it, in one step. Undefined when the
 * code is not live or the chat is already linked, whoever it belongs to.
 */
export async function redeemLinkCode(
  db: Db,
  codeHash: string,
  chat: { channel: string; chatId: string },
): Promise<Owner | undefined> {
  try {
    const { rows } = await sql<{ user_id: string; workspace_id: string }>`
      select user_id, workspace_id
      from system_redeem_link_code(${codeHash}, ${chat.channel}, ${chat.chatId})`.execute(db);
    const row = rows[0];
    return row === undefined ? undefined : { userId: row.user_id, workspaceId: row.workspace_id };
  } catch (error) {
    // Two codes spent for one chat at once: the second finds the chat taken.
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) return undefined;
    throw error;
  }
}

export interface LinkedDevice {
  id: string;
  channel: string;
  createdAt: Date;
}

/** This person's linked chats (not their browser sessions). */
export function listDevices(db: Db, owner: Owner): Promise<LinkedDevice[]> {
  return withOwner(db, owner, async (trx) => {
    const rows = await trx
      .selectFrom('devices')
      .select(['id', 'channel', 'created_at'])
      .where('channel', '<>', 'web')
      .orderBy('created_at')
      .execute();
    return rows.map((row) => ({ id: row.id, channel: row.channel, createdAt: row.created_at }));
  });
}

/**
 * Unlink a chat: the person's own, or any in their workspace when the caller is the admin. Returns
 * whose device it was, or undefined when there is no such device or the caller may not remove it.
 */
export function unlinkDevice(db: Db, caller: Owner, deviceId: string): Promise<string | undefined> {
  return withOwner(db, caller, async (trx) => {
    const { rows } = await sql<{ owner: string | null }>`
      select member_unlink_device(${deviceId}::uuid) as owner`.execute(trx);
    return rows[0]?.owner ?? undefined;
  });
}
