import { cancelTopup, ownerOf, requestTopup, type Db } from '../data/index.js';
import type { Logger } from '../ops/index.js';
import { approvalHash } from './approval-hash.js';
import { checkBudget, formatUsd, fromUnits, monthKey, toUnits, type KeySource } from './budget.js';

/** What a tap on "Ask for more" came to. */
export type AskOutcome =
  /** The admin has been asked. */
  | 'sent'
  /** This person already has a request waiting. */
  | 'open'
  /** The person is under their limit now (a stale button). */
  | 'unneeded'
  /** Nobody could be asked, or the tapper is not a member of this install. */
  | 'unavailable';

export interface TopupsOptions {
  db: Db;
  /** The fixed step the admin may grant: install config (a decimal string). */
  amountUsd: string;
  keySource: KeySource;
  defaultLimitUsd?: string | undefined;
  timezone: string;
  ttlMs: number;
  /** The channel the admin is asked on: the only one that can show Approve and Refuse yet. */
  adminChannel: string;
  /** Show the admin the question with its buttons. A failure means nobody could be asked. */
  askAdmin: (chatId: string, text: string, approvalId: string) => Promise<void>;
  now?: () => Date;
  logger?: Logger;
}

export interface Topups {
  ask: (chat: { channel: string; chatId: string }) => Promise<AskOutcome>;
}

/** What the admin's approval is bound to: this person, this amount, this month. */
const hashOf = (memberId: string, amountUsd: string, month: string): string =>
  approvalHash('budget.topup', { userId: memberId, amountUsd, month });

export function createTopups(options: TopupsOptions): Topups {
  const { db, timezone, now = () => new Date() } = options;
  // The same eight places the database stores, so the hash matches what it reads back.
  const amountUsd = fromUnits(toUnits(options.amountUsd));

  return {
    ask: async (chat) => {
      const member = await ownerOf(db, chat);
      if (member === undefined) return 'unavailable';
      const at = now();
      const verdict = await checkBudget(db, member, { ...options, now: at });
      if (verdict.allowed) return 'unneeded';
      const month = monthKey(at, timezone);
      const request = await requestTopup(db, member, {
        amountUsd,
        month,
        ...chat,
        adminChannel: options.adminChannel,
        now: at,
        expiresAt: new Date(at.getTime() + options.ttlMs),
        argsSha256: hashOf(member.userId, amountUsd, month),
      });
      if (request.outcome === 'open') return 'open';
      if (request.outcome !== 'created') return 'unavailable';
      const text = `${request.who} has used ${formatUsd(verdict.spentUsd)} of ${formatUsd(verdict.limitUsd)} this month and asks for more. Add ${formatUsd(amountUsd)} for this month?`;
      try {
        await options.askAdmin(request.adminChatId, text, request.approvalId);
      } catch {
        // Failing to close it must not turn into an error for the person: it lapses at its time.
        await cancelTopup(db, member, request.topupId).catch(() => {
          options.logger?.warn({ topupId: request.topupId }, 'top-up request not cancelled');
        });
        return 'unavailable';
      }
      return 'sent';
    },
  };
}
