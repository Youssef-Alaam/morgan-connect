import { sql } from 'kysely';
import type { Db } from './db.js';

/** True when this chat is a linked device. */
export async function isDeviceLinked(db: Db, channel: string, chatId: string): Promise<boolean> {
  const row = await db
    .selectFrom('devices')
    .select('id')
    .where('channel', '=', channel)
    .where('chat_id', '=', chatId)
    .executeTakeFirst();
  return row !== undefined;
}

/** Store a new unclaimed setup code hash, replacing any older unclaimed one. False if claimed. */
export async function replaceSetupCode(db: Db, codeHash: string): Promise<boolean> {
  return db.transaction().execute(async (trx) => {
    const admin = await trx.selectFrom('users').select('id').limit(1).executeTakeFirst();
    if (admin !== undefined) return false;
    await trx.deleteFrom('setup_codes').where('claimed_at', 'is', null).execute();
    await trx.insertInto('setup_codes').values({ code_hash: codeHash, claimed_at: null }).execute();
    return true;
  });
}

/** Use the code: one atomic step that marks it claimed, creates the admin and links the chat. */
export async function claimSetupCode(
  db: Db,
  codeHash: string,
  channel: string,
  chatId: string,
): Promise<boolean> {
  return db.transaction().execute(async (trx) => {
    // Share-row-exclusive: two claims cannot both see "no admin yet".
    await sql`lock table users in share row exclusive mode`.execute(trx);
    const admin = await trx.selectFrom('users').select('id').limit(1).executeTakeFirst();
    if (admin !== undefined) return false;
    const code = await trx
      .updateTable('setup_codes')
      .set({ claimed_at: new Date() })
      .where('code_hash', '=', codeHash)
      .where('claimed_at', 'is', null)
      .returning('id')
      .executeTakeFirst();
    if (code === undefined) return false;
    const user = await trx
      .insertInto('users')
      .values({ role: 'admin' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('devices')
      .values({ user_id: user.id, channel, chat_id: chatId })
      .execute();
    return true;
  });
}
