import { budgetOf, isAdmin, usageSince, type Db, type Owner } from '../data/index.js';

/** Whose credentials pay for the call. Only the admin's keys are limited (D46). */
export type KeySource = 'admin' | 'own';

export type BudgetVerdict =
  { allowed: true } | { allowed: false; limitUsd: string; spentUsd: string };

export interface BudgetOptions {
  keySource: KeySource;
  /** Where the month starts (an IANA name). */
  timezone: string;
  now: Date;
  /** The install default, for a person with no limit of their own. Unset: no limit. */
  defaultLimitUsd?: string | undefined;
}

const SCALE = 8;

/**
 * A decimal string as whole units of 1e-8, so money is never compared as a float. Takes only what
 * Postgres `numeric::text` and the settings regex produce; anything else throws rather than guess.
 */
export function toUnits(amount: string): bigint {
  if (!/^\d+(\.\d+)?$/.test(amount)) throw new Error('Not a plain decimal amount');
  const [whole = '0', fraction = ''] = amount.split('.');
  return BigInt(whole + fraction.padEnd(SCALE, '0').slice(0, SCALE));
}

/**
 * Asked before a model call starts. A call already running is never cut short (no half-turn), so
 * this is the only place the limit is enforced. Reaching the limit exactly counts as over it.
 */
export async function checkBudget(
  db: Db,
  owner: Owner,
  options: BudgetOptions,
): Promise<BudgetVerdict> {
  if (options.keySource !== 'admin') return { allowed: true };
  // The admin runs the install: no limit, default or own, ever holds them back.
  if (await isAdmin(db, owner)) return { allowed: true };
  const limitUsd = (await budgetOf(db, owner)) ?? options.defaultLimitUsd;
  if (limitUsd === undefined) return { allowed: true };
  const { month } = await usageSince(db, owner, options.now, options.timezone);
  if (toUnits(month.costUsd) < toUnits(limitUsd)) return { allowed: true };
  return { allowed: false, limitUsd, spentUsd: month.costUsd };
}
