import { sql } from 'kysely';
import type { Db, Owner } from './db.js';
import { withOwner } from './tenancy.js';

/**
 * The admin's account tools and a person's first steps (M2-5b), each one database function
 * (migration 0017) acting as the person set on the transaction. A non-admin gets `false` and
 * nothing is written. The app role may execute exactly these by name (ensureAppRole).
 */
export const ACCOUNT_FUNCTIONS: readonly string[] = [
  'admin_create_invite(text, integer, numeric)',
  'admin_create_account(text, text, numeric)',
  'member_accept_notice()',
];

/** Make an invite (only its hash is stored). False when the caller is not an admin. */
export async function createInvite(
  db: Db,
  admin: Owner,
  invite: { tokenHash: string; ttlSeconds: number; monthlyLimitUsd: number | null },
): Promise<boolean> {
  const { tokenHash, ttlSeconds, monthlyLimitUsd } = invite;
  return withOwner(db, admin, async (trx) => {
    const { rows } = await sql<{ ok: boolean }>`select admin_create_invite(
      ${tokenHash}, ${ttlSeconds}::integer, ${monthlyLimitUsd}::numeric) as ok`.execute(trx);
    return rows[0]?.ok === true;
  });
}

/** Make a member with a temporary password. False when the caller is not an admin. */
export async function createAccount(
  db: Db,
  admin: Owner,
  account: { email: string; passwordHash: string; monthlyLimitUsd: number | null },
): Promise<boolean> {
  const { email, passwordHash, monthlyLimitUsd } = account;
  return withOwner(db, admin, async (trx) => {
    const { rows } = await sql<{ ok: boolean }>`select admin_create_account(
      ${email}, ${passwordHash}, ${monthlyLimitUsd}::numeric) as ok`.execute(trx);
    return rows[0]?.ok === true;
  });
}

/** Set a new password, and record that the person was told the admin can read their chats. */
export function changePassword(
  db: Db,
  owner: Owner,
  change: { passwordHash: string; noticeAccepted: boolean },
): Promise<void> {
  return withOwner(db, owner, async (trx) => {
    await trx
      .updateTable('credentials')
      .set({ password_hash: change.passwordHash, must_change: false })
      .execute();
    if (change.noticeAccepted) await sql`select member_accept_notice()`.execute(trx);
  });
}
