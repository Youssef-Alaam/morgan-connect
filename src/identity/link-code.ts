import { randomBytes } from 'node:crypto';

/** How long a link code works. */
export const LINK_CODE_TTL_SECONDS = 10 * 60;

// 32 letters and digits without the look-alikes: one random byte maps evenly onto them.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LENGTH = 12;

/** A fresh code of 60 random bits, shown in groups of four: `K7QD-2MXP-9HWA`. */
export function newLinkCode(): string {
  const letters = Array.from(randomBytes(LENGTH), (byte) => ALPHABET.charAt(byte % 32)).join('');
  return letters.replace(/(.{4})(?=.)/g, '$1-');
}

/** What is hashed and compared: upper case, without dashes or spaces, so a retyped code still matches. */
export const normaliseLinkCode = (code: string): string =>
  code.toUpperCase().replaceAll(/[^A-Z0-9]/g, '');
