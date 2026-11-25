import { createHash, randomBytes } from 'node:crypto';
import { claimSetupCode, isDeviceLinked, replaceSetupCode, type Db } from '../data/index.js';
import { createFailureLimiter } from './limiter.js';

export type ClaimResult = 'claimed' | 'refused' | 'limited';

export interface Identity {
  /** A fresh one-time code, or undefined when the install is already claimed. Never stored plain. */
  issueSetupCode: () => Promise<string | undefined>;
  /** Try a code from a chat. Wrong tries are counted per chat; too many are `limited`. */
  claim: (channel: string, chatId: string, code: string) => Promise<ClaimResult>;
  isLinked: (channel: string, chatId: string) => Promise<boolean>;
}

const MAX_WRONG_TRIES = 5;
const WINDOW_MS = 15 * 60 * 1000;

const hashCode = (code: string): string => createHash('sha256').update(code).digest('hex');

export function createIdentity(db: Db, options: { now?: () => number } = {}): Identity {
  /** Once an admin exists nothing can be claimed, so skip the database. */
  let closed = false;
  const limiter = createFailureLimiter({
    max: MAX_WRONG_TRIES,
    windowMs: WINDOW_MS,
    now: options.now ?? Date.now,
  });
  return {
    issueSetupCode: async () => {
      const code = randomBytes(16).toString('base64url');
      if (await replaceSetupCode(db, hashCode(code))) return code;
      closed = true;
      return undefined;
    },
    claim: async (channel, chatId, code) => {
      if (closed) return 'refused';
      const key = `${channel}:${chatId}`;
      if (limiter.blocked(key)) return 'limited';
      // Counted before the database is asked, so concurrent tries cannot skip the limit.
      limiter.fail(key);
      if (!(await claimSetupCode(db, hashCode(code), channel, chatId))) return 'refused';
      limiter.reset(key);
      closed = true;
      return 'claimed';
    },
    isLinked: (channel, chatId) => isDeviceLinked(db, channel, chatId),
  };
}
