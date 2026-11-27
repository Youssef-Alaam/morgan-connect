import { budgetOf, isAdmin, topupTotal, usageSince, type Db, type Owner } from '../data/index.js';

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

/** The inverse of `toUnits`: a decimal string with 8 places. */
export function fromUnits(units: bigint): string {
  const digits = units.toString().padStart(SCALE + 1, '0');
  return `${digits.slice(0, -SCALE)}.${digits.slice(-SCALE)}`;
}

/** A USD amount for a person to read: two places, rounded half up (`5` gives `$5.00`). */
export function formatUsd(amount: string): string {
  const cents = (toUnits(amount) + 500_000n) / 1_000_000n;
  const digits = cents.toString().padStart(3, '0');
  return `$${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

/** The local month that contains `now`, as `2026-11`: the key a top-up is filed under. */
export function monthKey(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}`;
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
  const base = (await budgetOf(db, owner)) ?? options.defaultLimitUsd;
  if (base === undefined) return { allowed: true };
  // An approved top-up raises this month only: next month it is filed under another key.
  const extra = toUnits(await topupTotal(db, owner, monthKey(options.now, options.timezone)));
  const limitUsd = extra === 0n ? base : fromUnits(toUnits(base) + extra);
  const { month } = await usageSince(db, owner, options.now, options.timezone);
  if (toUnits(month.costUsd) < toUnits(limitUsd)) return { allowed: true };
  return { allowed: false, limitUsd, spentUsd: month.costUsd };
}
