import { sql } from 'kysely';
import type { Db, Owner } from './db.js';
import { withOwner } from './tenancy.js';

/** The app role may execute exactly this (ensureAppRole). */
export const BUDGET_FUNCTIONS: readonly string[] = ['admin_set_budget(uuid, numeric)'];

/** Up to 6 whole digits and 8 decimals: what `numeric(14, 8)` holds. Anything else is a mistake. */
const MONEY = /^\d{1,6}(\.\d{1,8})?$/;

/**
 * Set a member's monthly limit in USD (a decimal string, never a float; 0 pauses them). Only an
 * admin can: false when the caller is not one, or the member is not in their workspace. Either way
 * an audit row is written. A person cannot write their own row (RLS).
 */
export async function setBudget(
  db: Db,
  admin: Owner,
  memberId: string,
  limitUsd: string,
): Promise<boolean> {
  if (!MONEY.test(limitUsd))
    throw new Error('A budget is a plain USD amount with up to 8 decimals');
  return withOwner(db, admin, async (trx) => {
    const { rows } = await sql<{ ok: boolean }>`
      select admin_set_budget(${memberId}::uuid, ${limitUsd}::numeric) as ok`.execute(trx);
    return rows[0]?.ok === true;
  });
}

/** This person's own limit as a decimal string, or undefined when none is set (the default applies). */
export function budgetOf(db: Db, owner: Owner): Promise<string | undefined> {
  return withOwner(db, owner, async (trx) => {
    const row = await trx
      .selectFrom('budgets')
      .select('monthly_limit_usd')
      .where('user_id', '=', owner.userId)
      .executeTakeFirst();
    return row?.monthly_limit_usd;
  });
}

/** True when this person is the admin: a limit never applies to them. */
export function isAdmin(db: Db, owner: Owner): Promise<boolean> {
  return withOwner(db, owner, async (trx) => {
    const row = await trx
      .selectFrom('users')
      .select('role')
      .where('id', '=', owner.userId)
      .executeTakeFirst();
    return row?.role === 'admin';
  });
}
