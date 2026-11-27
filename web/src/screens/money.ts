const PLAIN = /^\d+(\.\d+)?$/;
const SCALE = 8;

/** A plain decimal string as whole units of 1e-8, so money is never compared as a float. */
function units(amount: string): bigint {
  const [whole = '0', fraction = ''] = amount.split('.');
  return BigInt(whole + fraction.padEnd(SCALE, '0').slice(0, SCALE));
}

/**
 * A USD amount from the server (a decimal string, never a float) as `$1.50`, rounded half up to
 * cents. Anything that is not a plain decimal comes back unchanged, so a surprise is visible.
 */
export function usd(amount: string): string {
  if (!PLAIN.test(amount)) return amount;
  const cents = (units(amount) + 500_000n) / 1_000_000n;
  const digits = cents.toString().padStart(3, '0');
  return `$${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

/** Two decimal amounts added, as a decimal string (the limit a top-up raises). */
export function plus(a: string, b: string): string {
  const sum = (units(a) + units(b)).toString().padStart(SCALE + 1, '0');
  return `${sum.slice(0, -SCALE)}.${sum.slice(-SCALE)}`;
}

/** True when `spent` has reached `limit` (the server counts reaching it as over). */
export function reached(spent: string, limit: string): boolean {
  return units(spent) >= units(limit);
}
