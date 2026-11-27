import { sql } from 'kysely';
import type { Db, Owner } from './db.js';
import { withOwner } from './tenancy.js';

/** The app role may execute exactly this (ensureAppRole). */
export const BUDGET_FUNCTIONS: readonly string[] = [
  'admin_set_budget(uuid, numeric)',
  'admin_usage_summary(timestamptz, text)',
];

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

export interface BudgetLine {
  id: string;
  role: string;
  /** Undefined for someone with only a linked chat and no web login. */
  email: string | undefined;
  /** Their own monthly limit (a decimal string), or undefined when the install default applies. */
  limitUsd: string | undefined;
  /** Their own parallel-task cap, or undefined when the default applies. */
  taskCap: number | undefined;
  /** The top-up step the admin set for them, or undefined when the install's applies. */
  topupStepUsd: string | undefined;
  /** Approved top-ups for the month, a decimal string. */
  topupUsd: string;
  spentUsd: string;
  calls: number;
}

export interface BudgetSummary {
  /** The local month the totals cover, `2026-11`. */
  month: string;
  people: BudgetLine[];
}

/**
 * Every person's spend this local month beside their limit, for the admin's budgets page. Undefined
 * when the caller is not the admin. One audit row is written either way (migration 0036).
 */
export async function budgetSummary(
  db: Db,
  admin: Owner,
  now: Date,
  timezone: string,
): Promise<BudgetSummary | undefined> {
  const { rows } = await withOwner(db, admin, (trx) =>
    sql<{
      user_id: string;
      role: string;
      email: string | null;
      limit_usd: string | null;
      task_cap: number | null;
      topup_step: string | null;
      topup_usd: string;
      spent_usd: string;
      calls: string;
      month: string;
    }>`select * from admin_usage_summary(${now}::timestamptz, ${timezone})`.execute(trx),
  );
  const first = rows[0];
  if (first === undefined) return undefined;
  return {
    month: first.month,
    people: rows.map((row) => ({
      id: row.user_id,
      role: row.role,
      email: row.email ?? undefined,
      limitUsd: row.limit_usd ?? undefined,
      taskCap: row.task_cap ?? undefined,
      topupStepUsd: row.topup_step ?? undefined,
      topupUsd: row.topup_usd,
      spentUsd: row.spent_usd,
      calls: Number(row.calls),
    })),
  };
}
