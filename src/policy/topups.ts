import {
  consumeApproval,
  decideApproval,
  cancelTopup,
  openTopupFor,
  ownerOf,
  requestTopup,
  resolveTopup,
  type Db,
  type OpenTopup,
  type Owner,
  type ResolvedTopup,
} from '../data/index.js';
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
  /** The channel the admin is asked on: the only one that can show Approve and Deny yet. */
  adminChannel: string;
  /** Show the admin the question with its buttons. A failure means nobody could be asked. */
  askAdmin: (chatId: string, text: string, approvalId: string) => Promise<void>;
  /** Tell the member what the admin decided; a failure is not the admin's problem. */
  tell: (channel: string, chatId: string, text: string) => Promise<void>;
  now?: () => Date;
  logger?: Logger;
}

export interface Topups {
  ask: (chat: { channel: string; chatId: string }) => Promise<AskOutcome>;
  /**
   * The admin's tap on a question. Undefined when the question is not a top-up (the caller passes
   * it on); otherwise whether the tap counted.
   */
  decide: (answer: {
    id: string;
    decision: 'approved' | 'denied';
    channel: string;
    chatId: string;
  }) => Promise<boolean | undefined>;
}

/** What the admin's approval is bound to: this person, this amount, this month. */
const hashOf = (memberId: string, amountUsd: string, month: string): string =>
  approvalHash('budget.topup', { userId: memberId, amountUsd, month });

/** Spend the approval, then answer the request. Undefined when either step did not take. */
function settle(
  options: TopupsOptions,
  admin: Owner,
  topup: OpenTopup,
  answer: { id: string; decision: 'approved' | 'denied'; now: Date },
): Promise<ResolvedTopup | undefined> {
  const approved = answer.decision === 'approved';
  const answerIt = (): Promise<ResolvedTopup | undefined> =>
    resolveTopup(options.db, admin, topup.topupId, approved ? 'approved' : 'refused');
  if (!approved) return answerIt();
  const argsSha256 = hashOf(topup.memberId, fromUnits(toUnits(topup.amountUsd)), topup.month);
  return consumeApproval(options.db, admin, { id: answer.id, argsSha256, now: answer.now }).then(
    (spent) => (spent ? answerIt() : undefined),
  );
}

/** The admin's answer, applied: who may answer and that it counts once are the approvals store's job. */
async function apply(
  options: TopupsOptions,
  admin: Owner,
  topup: OpenTopup,
  answer: { id: string; decision: 'approved' | 'denied'; channel: string; chatId: string },
): Promise<boolean> {
  const at = (options.now ?? (() => new Date()))();
  if (!(await decideApproval(options.db, { ...answer, now: at }))) return false;
  const resolved = await settle(options, admin, topup, { ...answer, now: at }).catch(
    () => undefined,
  );
  if (resolved === undefined) {
    // The tap counted but the answer did not take: close the request, so the member can ask again
    // instead of waiting for it to lapse. If even that fails, it lapses at its own time.
    await resolveTopup(options.db, admin, topup.topupId, 'refused').catch(() => undefined);
    return false;
  }
  const text =
    answer.decision === 'approved'
      ? `${formatUsd(resolved.amountUsd)} was added to this month's limit. Carry on.`
      : 'The admin said no to more this month.';
  await options.tell(resolved.channel, resolved.chatId, text).catch(() => undefined);
  return true;
}

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
        // Close it so the member can ask again. If closing fails too, log it and let it lapse:
        // the person is told "Not available", never an error.
        await cancelTopup(db, member, request.topupId).catch(() => {
          options.logger?.warn({ topupId: request.topupId }, 'top-up request not cancelled');
        });
        return 'unavailable';
      }
      return 'sent';
    },
    decide: async (answer) => {
      const admin = await ownerOf(db, answer);
      if (admin === undefined) return undefined;
      const topup = await openTopupFor(db, admin, answer.id);
      return topup === undefined ? undefined : apply(options, admin, topup, answer);
    },
  };
}
