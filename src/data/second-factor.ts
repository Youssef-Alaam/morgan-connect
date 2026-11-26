import type { Db, Owner } from './db.js';
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

/**
 * Turn the authenticator on with the step of the code just shown, and store the backup codes
 * (hashes) in the same step. False when there is nothing pending to confirm.
 */
export function confirmTotp(
  db: Db,
  owner: Owner,
  confirm: { step: number; codeHashes: string[] },
): Promise<boolean> {
  return withOwner(db, owner, async (trx) => {
    const done = await trx
      .updateTable('totp_factors')
      .set({ confirmed_at: new Date(), last_step: confirm.step })
      .where('confirmed_at', 'is', null)
      .returning('user_id')
      .executeTakeFirst();
    if (done === undefined) return false;
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
