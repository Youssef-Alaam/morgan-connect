import type { Transaction } from 'kysely';
import type { Database, Db, Owner } from './db.js';
import { withOwner } from './tenancy.js';

/** The authenticator secret (sealed) and backup codes (hashed) of one person. Rows are theirs alone (RLS). */

/** Begin enrolling: store a fresh unconfirmed secret. False when an authenticator is already on. */
export function startTotp(db: Db, owner: Owner, secretSealed: string): Promise<boolean> {
  return withOwner(db, owner, async (trx) => {
    const row = await trx
      .insertInto('totp_factors')
      .values({
        user_id: owner.userId,
        workspace_id: owner.workspaceId,
        secret_sealed: secretSealed,
      })
      .onConflict((oc) =>
        oc
          .column('user_id')
          .doUpdateSet({ secret_sealed: secretSealed })
          .where('totp_factors.confirmed_at', 'is', null),
      )
      .returning('user_id')
      .executeTakeFirst();
    return row !== undefined;
  });
}

/** The sealed secret of an authenticator not yet confirmed, or undefined. */
export function pendingTotp(db: Db, owner: Owner): Promise<string | undefined> {
  return withOwner(db, owner, async (trx) => {
    const row = await trx
      .selectFrom('totp_factors')
      .select('secret_sealed')
      .where('confirmed_at', 'is', null)
      .executeTakeFirst();
    return row?.secret_sealed;
  });
}

/** Sign out every other browser session of this person (a change of second factor ends them). */
async function endOtherSessions(trx: Transaction<Database>, keepSessionId: string): Promise<void> {
  const others = await trx
    .selectFrom('sessions')
    .select('id')
    .where('id', '<>', keepSessionId)
    .execute();
  const ids = others.map((row) => row.id);
  if (ids.length === 0) return;
  await trx
    .deleteFrom('devices')
    .where('channel', '=', 'web')
    .where('chat_id', 'in', ids)
    .execute();
  await trx.deleteFrom('sessions').where('id', 'in', ids).execute();
}

/**
 * Turn the authenticator on with the step of the code just shown, and store the backup codes
 * (hashes) in the same step, and end the person's other sessions. False when the secret that was
 * checked (`sealed`) is no longer the pending one.
 */
export function confirmTotp(
  db: Db,
  owner: Owner,
  confirm: { sealed: string; step: number; codeHashes: string[]; keepSessionId: string },
): Promise<boolean> {
  return withOwner(db, owner, async (trx) => {
    const done = await trx
      .updateTable('totp_factors')
      .set({ confirmed_at: new Date(), last_step: confirm.step })
      .where('confirmed_at', 'is', null)
      .where('secret_sealed', '=', confirm.sealed)
      .returning('user_id')
      .executeTakeFirst();
    if (done === undefined) return false;
    await endOtherSessions(trx, confirm.keepSessionId);
    await trx.deleteFrom('backup_codes').execute();
    await trx
      .insertInto('backup_codes')
      .values(
        confirm.codeHashes.map((hash) => ({
          user_id: owner.userId,
          workspace_id: owner.workspaceId,
          code_hash: hash,
        })),
      )
      .execute();
    return true;
  });
}

/** The sealed secret of the authenticator that is switched on, or undefined when there is none. */
export function activeTotp(db: Db, owner: Owner): Promise<string | undefined> {
  return withOwner(db, owner, async (trx) => {
    const row = await trx
      .selectFrom('totp_factors')
      .select('secret_sealed')
      .where('confirmed_at', 'is not', null)
      .executeTakeFirst();
    return row?.secret_sealed;
  });
}

/** Use up a 30-second step: true only when it is newer than every step used before. */
export function spendTotpStep(db: Db, owner: Owner, step: number): Promise<boolean> {
  return withOwner(db, owner, async (trx) => {
    const row = await trx
      .updateTable('totp_factors')
      .set({ last_step: step })
      .where('confirmed_at', 'is not', null)
      .where('last_step', '<', String(step))
      .returning('user_id')
      .executeTakeFirst();
    return row !== undefined;
  });
}

/** Use up a backup code by its hash: true the first time only. */
export function spendBackupCode(db: Db, owner: Owner, codeHash: string): Promise<boolean> {
  return withOwner(db, owner, async (trx) => {
    const row = await trx
      .updateTable('backup_codes')
      .set({ used_at: new Date() })
      .where('code_hash', '=', codeHash)
      .where('used_at', 'is', null)
      .returning('id')
      .executeTakeFirst();
    return row !== undefined;
  });
}

/** Turn the second factor off: the authenticator, every backup code and the other sessions go. */
export function removeTotp(db: Db, owner: Owner, keepSessionId: string): Promise<void> {
  return withOwner(db, owner, async (trx) => {
    await trx.deleteFrom('backup_codes').execute();
    await trx.deleteFrom('totp_factors').execute();
    await endOtherSessions(trx, keepSessionId);
  });
}
