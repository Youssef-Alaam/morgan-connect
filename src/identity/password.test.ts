import { expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

it('accepts the right password, refuses another, and salts every hash', async () => {
  const [one, two] = await Promise.all([
    hashPassword('correct horse'),
    hashPassword('correct horse'),
  ]);
  expect(one).not.toBe(two);
  expect(one).not.toContain('correct horse');
  expect(await verifyPassword('correct horse', one)).toBe(true);
  expect(await verifyPassword('wrong horse', one)).toBe(false);
});

it('refuses a stored value that is not one of ours', async () => {
  for (const stored of [
    '',
    'plain',
    'bcrypt$1$2$3$a$b',
    'scrypt$x$8$3$AAAA$AAAA',
    'scrypt$32768$8$3$AAAA$AA',
  ]) {
    expect(await verifyPassword('anything', stored)).toBe(false);
  }
});
