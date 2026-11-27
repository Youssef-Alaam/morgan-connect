import { sql } from 'kysely';
import type { Db, Owner } from './db.js';
import { withOwner } from './tenancy.js';

export interface Person {
  id: string;
  role: string;
  /** Undefined for someone who only has a linked chat and no web login. */
  email: string | undefined;
  /** `temporary_password` until the person has changed the one the admin gave them. */
  status: 'active' | 'temporary_password';
  createdAt: Date;
  devices: { id: string; channel: string; createdAt: Date }[];
}

/**
 * Everyone in the admin's workspace with their linked chats. Undefined when the caller is not the
 * admin (the database function returns nothing, and an admin always sees at least themselves).
 */
export async function listPeople(db: Db, admin: Owner): Promise<Person[] | undefined> {
  const { rows } = await withOwner(db, admin, (trx) =>
    sql<{
      user_id: string;
      role: string;
      email: string | null;
      must_change: boolean;
      created_at: Date;
      device_id: string | null;
      channel: string | null;
      device_created_at: Date | null;
    }>`select * from admin_list_people()`.execute(trx),
  );
  if (rows.length === 0) return undefined;
  const people = new Map<string, Person>();
  for (const row of rows) {
    const person = people.get(row.user_id) ?? {
      id: row.user_id,
      role: row.role,
      email: row.email ?? undefined,
      status: row.must_change ? ('temporary_password' as const) : ('active' as const),
      createdAt: row.created_at,
      devices: [],
    };
    if (row.device_id !== null && row.channel !== null && row.device_created_at !== null) {
      person.devices.push({
        id: row.device_id,
        channel: row.channel,
        createdAt: row.device_created_at,
      });
    }
    people.set(row.user_id, person);
  }
  return [...people.values()];
}

export interface PendingInvite {
  id: string;
  monthlyLimitUsd: number | undefined;
  createdAt: Date;
  expiresAt: Date;
}

/** The open invites of the admin's workspace, whoever made them (the same set revoke acts on). */
export function listInvites(db: Db, admin: Owner): Promise<PendingInvite[]> {
  return withOwner(db, admin, async (trx) => {
    const { rows } = await sql<{
      id: string;
      monthly_limit_usd: string | null;
      created_at: Date;
      expires_at: Date;
    }>`select * from admin_list_invites()`.execute(trx);
    return rows.map((row) => ({
      id: row.id,
      monthlyLimitUsd: row.monthly_limit_usd === null ? undefined : Number(row.monthly_limit_usd),
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    }));
  });
}

/** Revoke an unused invite. False when there is none such, it was used, or the caller is not the admin. */
export function revokeInvite(db: Db, admin: Owner, inviteId: string): Promise<boolean> {
  return withOwner(db, admin, async (trx) => {
    const { rows } = await sql<{ ok: boolean }>`
      select admin_revoke_invite(${inviteId}::uuid) as ok`.execute(trx);
    return rows[0]?.ok === true;
  });
}
