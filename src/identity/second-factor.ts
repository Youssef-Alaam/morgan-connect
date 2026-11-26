import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  randomInt,
} from 'node:crypto';
import { Secret, TOTP } from 'otpauth';

/** Authenticator-app codes (RFC 6238): six digits, 30 seconds, one step either side for clock drift. */
const PERIOD_SECONDS = 30;
const DRIFT_STEPS = 1;
const ISSUER = 'Morgan';
/** Letters and digits that cannot be mistaken for each other when read off a screen. */
const BACKUP_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const BACKUP_LENGTH = 10;
export const BACKUP_CODE_COUNT = 10;

/** One purpose-bound key out of the master key, so sealing and hashing never share a key. */
const subkey = (master: Buffer, purpose: string): Buffer =>
  Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), `morgan-two-factor/${purpose}`, 32));

const totp = (secret: Secret, label = 'account'): TOTP =>
  new TOTP({ issuer: ISSUER, label, secret, period: PERIOD_SECONDS });

/** A fresh authenticator secret, in the base32 form apps ask for. */
export const newTotpSecret = (): string => new Secret({ size: 20 }).base32;

/** The `otpauth://` address an app reads from the QR code. */
export const totpUri = (secret: string, label: string): string =>
  totp(Secret.fromBase32(secret), label).toString();

/**
 * The time step this code belongs to, or undefined when it is wrong. The caller must refuse a step
 * that is not newer than the last one used, which is what stops a code being used twice.
 */
export function checkTotp(secret: string, code: string, nowMs: number): number | undefined {
  if (!/^\d{6}$/.test(code)) return undefined;
  const delta = totp(Secret.fromBase32(secret)).validate({
    token: code,
    timestamp: nowMs,
    window: DRIFT_STEPS,
  });
  return delta === null ? undefined : Math.floor(nowMs / 1000 / PERIOD_SECONDS) + delta;
}

/** Encrypt a secret for the database (AES-256-GCM); bound to the person, so it cannot be moved to another row. */
export function sealSecret(key: Buffer, userId: string, plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', subkey(key, 'seal'), iv);
  cipher.setAAD(Buffer.from(userId));
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((part) => part.toString('base64url')).join('.');
}

/** The secret behind `sealSecret`; throws when the key, the person or the stored value is wrong. */
export function openSecret(key: Buffer, userId: string, sealed: string): string {
  const [iv, tag, body] = sealed.split('.').map((part) => Buffer.from(part, 'base64url'));
  if (iv === undefined || tag === undefined || body === undefined) throw new Error('bad secret');
  const decipher = createDecipheriv('aes-256-gcm', subkey(key, 'seal'), iv);
  decipher.setAAD(Buffer.from(userId));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

/** Ten random one-use codes, shown once as `xxxxx-xxxxx`. */
export function newBackupCodes(): string[] {
  return Array.from({ length: BACKUP_CODE_COUNT }, () => {
    const chars = Array.from(
      { length: BACKUP_LENGTH },
      () => BACKUP_ALPHABET[randomInt(BACKUP_ALPHABET.length)],
    ).join('');
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
}

/** What is stored for a backup code: a keyed hash, so a copy of the database alone cannot be searched for codes. */
export function hashBackupCode(key: Buffer, code: string): string {
  const plain = code.toLowerCase().replace(/[\s-]/g, '');
  return createHmac('sha256', subkey(key, 'backup-code')).update(plain).digest('hex');
}
