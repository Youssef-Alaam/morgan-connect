import { sql } from 'kysely';
import type { Db, Owner } from './db.js';
import { withOwner } from './tenancy.js';

/** The app role may execute exactly this (ensureAppRole). */
export const TASK_CAP_FUNCTIONS: readonly string[] = ['admin_set_task_cap(uuid, integer)'];

/** How many turns one person runs at once when the admin has not set a cap (spec D24). */
export const DEFAULT_TASK_CAP = 2;

/**
 * Set how many tasks a member may run at once (null goes back to the default). Only an admin can:
 * false when the caller is not one, or the member is not in their workspace. Audited either way.
 */
export async function setTaskCap(
  db: Db,
  admin: Owner,
  memberId: string,
  cap: number | null,
): Promise<boolean> {
  if (cap !== null && !(Number.isInteger(cap) && cap >= 1)) {
    throw new Error('A task cap is a whole number of at least 1');
  }
  return withOwner(db, admin, async (trx) => {
    const { rows } = await sql<{ ok: boolean }>`
      select admin_set_task_cap(${memberId}::uuid, ${cap}::integer) as ok`.execute(trx);
    return rows[0]?.ok === true;
  });
}

/** This person's cap: their own, else the default. */
export function taskCapOf(db: Db, owner: Owner): Promise<number> {
  return withOwner(db, owner, async (trx) => {
    const row = await trx
      .selectFrom('users')
      .select('max_parallel_tasks')
      .where('id', '=', owner.userId)
      .executeTakeFirst();
    return row?.max_parallel_tasks ?? DEFAULT_TASK_CAP;
  });
}
