import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// scrypt, OWASP's N=2^15, r=8, p=3 setting: about 32 MiB per hash, built into Node, no package.
const COST = { N: 2 ** 15, r: 8, p: 3 };
const KEY_BYTES = 32;
const MAX_MEMORY = 64 * 1024 * 1024;

function derive(password: string, salt: Buffer, cost: typeof COST): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, { ...cost, maxmem: MAX_MEMORY }, (error, key) => {
      if (error === null) resolve(key);
      else reject(error);
    });
  });
}

/** `scrypt$N$r$p$salt$key`: the cost is stored, so it can be raised later without a migration. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, COST);
  const { N, r, p } = COST;
  return ['scrypt', N, r, p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

/** True only for the right password; a stored value that is not one of ours is simply false. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [tag, n, r, p, salt, key] = stored.split('$');
  if (tag !== 'scrypt' || salt === undefined || key === undefined) return false;
  const cost = { N: Number(n), r: Number(r), p: Number(p) };
  try {
    const expected = Buffer.from(key, 'base64url');
    const actual = await derive(password, Buffer.from(salt, 'base64url'), cost);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
