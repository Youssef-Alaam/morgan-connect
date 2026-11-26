import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// scrypt, OWASP's N=2^15, r=8, p=3 setting: about 32 MiB per hash, built into Node, no package.
const COST = { N: 2 ** 15, r: 8, p: 3 };
const KEY_BYTES = 32;
const MAX_MEMORY = 64 * 1024 * 1024;

type Cost = typeof COST;

function derive(password: string, salt: Buffer, cost: Cost): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, { ...cost, maxmem: MAX_MEMORY }, (error, key) => {
      if (error === null) resolve(key);
      else reject(error);
    });
  });
}

export interface PasswordHasher {
  /** `scrypt$N$r$p$salt$key`: the cost is stored, so it can be raised later without a migration. */
  hash: (password: string) => Promise<string>;
  /** True only for the right password; a stored value that is not one of ours is simply false. */
  verify: (password: string, stored: string) => Promise<boolean>;
}

/** Hashing with at most `maxRunning` at once (about 32 MiB each); the rest wait their turn. */
export function createPasswordHasher(maxRunning = 4): PasswordHasher {
  let running = 0;
  const waiting: (() => void)[] = [];
  const capped = async <T>(work: () => Promise<T>): Promise<T> => {
    if (running >= maxRunning) await new Promise<void>((resolve) => waiting.push(resolve));
    else running++;
    try {
      return await work();
    } finally {
      // The slot passes straight to the next waiter, or is freed.
      const next = waiting.shift();
      if (next === undefined) running--;
      else next();
    }
  };
  return {
    hash: (password) =>
      capped(async () => {
        const salt = randomBytes(16);
        const key = await derive(password, salt, COST);
        const { N, r, p } = COST;
        return ['scrypt', N, r, p, salt.toString('base64url'), key.toString('base64url')].join('$');
      }),
    verify: (password, stored) =>
      capped(async () => {
        const [tag, n, r, p, salt, key] = stored.split('$');
        if (tag !== 'scrypt' || salt === undefined || key === undefined) return false;
        try {
          const expected = Buffer.from(key, 'base64url');
          const cost = { N: Number(n), r: Number(r), p: Number(p) };
          const actual = await derive(password, Buffer.from(salt, 'base64url'), cost);
          return expected.length === actual.length && timingSafeEqual(expected, actual);
        } catch {
          return false;
        }
      }),
  };
}
