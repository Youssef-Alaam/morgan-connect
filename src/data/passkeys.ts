import { sql } from 'kysely';
import type { Db, Owner } from './db.js';
import { withOwner } from './tenancy.js';

/** A person's registered passkeys. Rows are theirs alone (RLS); sign-in finds one by `passkeyByCredential`. */

export interface Passkey {
  id: string;
  credentialId: string;
  transports: string[] | null;
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export interface NewPasskey {
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string[] | undefined;
  name: string;
}

/** Store a registered passkey; a credential id already in use anywhere raises a unique violation. */
export function addPasskey(db: Db, owner: Owner, passkey: NewPasskey): Promise<string> {
  return withOwner(db, owner, async (trx) => {
    const row = await trx
      .insertInto('passkeys')
      .values({
        user_id: owner.userId,
        workspace_id: owner.workspaceId,
        credential_id: passkey.credentialId,
        public_key: passkey.publicKey,
        counter: passkey.counter,
        transports: passkey.transports ?? null,
        name: passkey.name,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  });
}

/** This person's passkeys, oldest first. */
export function listPasskeys(db: Db, owner: Owner): Promise<Passkey[]> {
  return withOwner(db, owner, async (trx) => {
    const rows = await trx
      .selectFrom('passkeys')
      .select(['id', 'credential_id', 'transports', 'name', 'created_at', 'last_used_at'])
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    return rows.map((row) => ({
      id: row.id,
      credentialId: row.credential_id,
      transports: row.transports,
      name: row.name,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
    }));
  });
}

/** After a good sign-in: remember the authenticator's new signature count. */
export function recordPasskeyUse(
  db: Db,
  owner: Owner,
  credentialId: string,
  counter: number,
): Promise<void> {
  return withOwner(db, owner, async (trx) => {
    await trx
      .updateTable('passkeys')
      .set({ counter, last_used_at: new Date() })
      .where('credential_id', '=', credentialId)
      .execute();
  });
}

/**
 * Remove one passkey. 'last_method' when it is the only way left to sign in (no password and no
 * other passkey); the count and the delete run under one lock, so two removals cannot both pass.
 */
export function removePasskey(
  db: Db,
  owner: Owner,
  id: string,
): Promise<'removed' | 'not_found' | 'last_method'> {
  return withOwner(db, owner, async (trx) => {
    await sql`select pg_advisory_xact_lock(hashtext(${owner.userId}))`.execute(trx);
    const mine = await trx.selectFrom('passkeys').select('id').execute();
    if (!mine.some((row) => row.id === id)) return 'not_found';
    const password = await trx.selectFrom('credentials').select('user_id').executeTakeFirst();
    if (mine.length === 1 && password === undefined) return 'last_method';
    await trx.deleteFrom('passkeys').where('id', '=', id).execute();
    return 'removed';
  });
}
