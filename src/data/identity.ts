import type { Db } from './db.js';
import { chatOwner, claimInstall, installClaimed } from './system.js';

/** True when this chat is a linked device. */
export async function isDeviceLinked(db: Db, channel: string, chatId: string): Promise<boolean> {
  return (await chatOwner(db, { channel, chatId })) !== undefined;
}

/** Store a new unclaimed setup code hash, replacing any older unclaimed one. False if claimed. */
export async function replaceSetupCode(db: Db, codeHash: string): Promise<boolean> {
  return db.transaction().execute(async (trx) => {
    if (await installClaimed(trx)) return false;
    await trx.deleteFrom('setup_codes').where('claimed_at', 'is', null).execute();
    await trx.insertInto('setup_codes').values({ code_hash: codeHash, claimed_at: null }).execute();
    return true;
  });
}

/** Use the code: one atomic step that marks it claimed, creates the admin and links the chat. */
export function claimSetupCode(
  db: Db,
  codeHash: string,
  channel: string,
  chatId: string,
): Promise<boolean> {
  return claimInstall(db, { codeHash, channel, chatId });
}
