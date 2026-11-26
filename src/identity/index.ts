import { createHash, randomBytes } from 'node:crypto';
import {
  appendAudit,
  claimSetupCode,
  isDeviceLinked,
  redeemLinkCode,
  replaceSetupCode,
  type Db,
} from '../data/index.js';
import { createFailureLimiter } from './limiter.js';
import { normaliseLinkCode } from './link-code.js';

export type ClaimResult = 'claimed' | 'refused' | 'limited';

export interface Identity {
  /** A fresh one-time code, or undefined when the install is already claimed. Never stored plain. */
  issueSetupCode: () => Promise<string | undefined>;
  /** Try a code from a chat. Wrong tries are counted per chat; too many are `limited`. */
  claim: (channel: string, chatId: string, code: string) => Promise<ClaimResult>;
  isLinked: (channel: string, chatId: string) => Promise<boolean>;
  /**
   * `/link <code>` from an unlinked chat: make it a device of the person who asked for the code.
   * Wrong tries share the chat's limit with `claim`.
   */
  link: (channel: string, chatId: string, code: string) => Promise<ClaimResult>;
}

const MAX_WRONG_TRIES = 5;
const WINDOW_MS = 15 * 60 * 1000;

const hashCode = (code: string): string => createHash('sha256').update(code).digest('hex');

/** One audit row for a chat that has just become a device of this person. */
const auditLink = (db: Db, chat: { channel: string; chatId: string }, userId: string) =>
  appendAudit(db, {
    ...chat,
    tool: 'device.link',
    actionType: 'device.link',
    changesState: true,
    argNames: [],
    extraArgs: 0,
    argsSha256: hashCode(''),
    decision: 'auto',
    outcome: 'ok',
    subjectUserId: userId,
  });

export function createIdentity(
  db: Db,
  options: { now?: () => number; onClaimed?: () => Promise<void> } = {},
): Identity {
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
      await options.onClaimed?.();
      return 'claimed';
    },
    isLinked: (channel, chatId) => isDeviceLinked(db, channel, chatId),
    link: async (channel, chatId, code) => {
      const key = `${channel}:${chatId}`;
      if (limiter.blocked(key)) return 'limited';
      limiter.fail(key);
      const owner = await redeemLinkCode(db, hashCode(normaliseLinkCode(code)), {
        channel,
        chatId,
      });
      if (owner === undefined) return 'refused';
      limiter.reset(key);
      await auditLink(db, { channel, chatId }, owner.userId);
      return 'claimed';
    },
  };
}
export { announceAdminLink } from './admin-link.js';
