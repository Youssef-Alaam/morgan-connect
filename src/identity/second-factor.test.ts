import { Secret, TOTP } from 'otpauth';
import { expect, it } from 'vitest';
import {
  BACKUP_CODE_COUNT,
  checkTotp,
  hashBackupCode,
  newBackupCodes,
  newTotpSecret,
  openSecret,
  sealSecret,
  totpUri,
} from './second-factor.js';

const KEY = Buffer.alloc(32, 1);
const NOW = Date.UTC(2026, 10, 26, 12, 0, 10);
const STEP = Math.floor(NOW / 30_000);
const codeAt = (secret: string, ms: number): string =>
  new TOTP({ secret: Secret.fromBase32(secret) }).generate({ timestamp: ms });

it('accepts the code of this step and one step either side, and says which step it was', () => {
  const secret = newTotpSecret();
  expect(checkTotp(secret, codeAt(secret, NOW), NOW)).toBe(STEP);
  expect(checkTotp(secret, codeAt(secret, NOW - 30_000), NOW)).toBe(STEP - 1);
  expect(checkTotp(secret, codeAt(secret, NOW + 30_000), NOW)).toBe(STEP + 1);
});

it('refuses a code two steps away, a wrong code and anything that is not six digits', () => {
  const secret = newTotpSecret();
  expect(checkTotp(secret, codeAt(secret, NOW - 90_000), NOW)).toBeUndefined();
  const wrong = codeAt(secret, NOW) === '000000' ? '000001' : '000000';
  expect(checkTotp(secret, wrong, NOW)).toBeUndefined();
  expect(checkTotp(secret, '12345', NOW)).toBeUndefined();
  expect(checkTotp(secret, 'abcdef', NOW)).toBeUndefined();
});

it('builds the address an app reads from the QR code', () => {
  const secret = newTotpSecret();
  const uri = totpUri(secret, 'a@example.test');
  expect(uri).toContain('otpauth://totp/Morgan:a%40example.test');
  expect(uri).toContain(`secret=${secret}`);
});

it('seals a secret so it can only be opened with the same key and for the same person', () => {
  const sealed = sealSecret(KEY, 'user-1', 'JBSWY3DPEHPK3PXP');
  expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
  expect(sealSecret(KEY, 'user-1', 'JBSWY3DPEHPK3PXP')).not.toBe(sealed);
  expect(openSecret(KEY, 'user-1', sealed)).toBe('JBSWY3DPEHPK3PXP');
  expect(() => openSecret(KEY, 'user-2', sealed)).toThrow();
  expect(() => openSecret(Buffer.alloc(32, 2), 'user-1', sealed)).toThrow();
  expect(() => openSecret(KEY, 'user-1', 'not-sealed')).toThrow();
});

it('makes ten different backup codes and hashes them with the key, ignoring case and dashes', () => {
  const codes = newBackupCodes();
  expect(codes).toHaveLength(BACKUP_CODE_COUNT);
  expect(new Set(codes).size).toBe(BACKUP_CODE_COUNT);
  for (const code of codes) expect(code).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
  const [first = ''] = codes;
  const hash = hashBackupCode(KEY, first);
  expect(hash).not.toContain(first.replace('-', ''));
  expect(hashBackupCode(KEY, first.toUpperCase().replace('-', ' '))).toBe(hash);
  expect(hashBackupCode(Buffer.alloc(32, 2), first)).not.toBe(hash);
});
