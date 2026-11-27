import {
  consumeApproval,
  createApproval,
  decideApproval,
  ownerOf,
  type Db,
} from '../data/index.js';
import type { ToolDefinition } from '../tools/index.js';
import { approvalHash } from './approval-hash.js';
import { createWaitingRoom } from './approval-wait.js';
import type { Caller } from './recorder.js';

/** What the person decided, or why nobody did. Only `approved` lets the tool run. */
export type Verdict = 'approved' | 'denied' | 'expired' | 'aborted' | 'unavailable';
type Described = Pick<ToolDefinition, 'name' | 'actionType'>;

/** The question as the channel shows it. `text` holds the exact arguments. */
export interface ApprovalPrompt {
  id: string;
  caller: Caller;
  text: string;
  expiresAt: Date;
}

/** How a question ended: the owner's answer, no answer in time, or the turn gave up. */
type Outcome = 'approved' | 'denied' | 'expired' | 'aborted';

export interface ApprovalsOptions {
  db: Db;
  /** Show the question to the chat with Approve and Deny. A failure means nobody could be asked. */
  prompt: (prompt: ApprovalPrompt) => Promise<void>;
  /**
   * Show the chat that a question is over, so a card that is still on screen can settle. Best
   * effort: a failure here never changes the verdict.
   */
  closed?: (ended: { id: string; caller: Caller; outcome: Outcome }) => Promise<void>;
  /** How long a question stays open. */
  ttlMs: number;
  now?: () => Date;
}

export interface Approvals {
  /** Ask the chat's owner and wait. The turn stays paused here until an answer, expiry or abort. */
  request: (call: {
    caller: Caller;
    tool: Described;
    args: Record<string, unknown>;
    signal?: AbortSignal | undefined;
  }) => Promise<Verdict>;
  /** The owner's tap. False when it does not count: wrong chat, already answered, or too late. */
  decide: (
    id: string,
    decision: 'approved' | 'denied',
    from: { channel: string; chatId: string },
  ) => Promise<boolean>;
}

/** Telegram holds 4096 characters; what the owner approves must be shown in full or not asked. */
const MAX_SHOWN = 3000;

/** The owner sees this JSON, and `approvalHash` covers the same JSON of the same args. */
function describeCall(tool: Described, args: Record<string, unknown>): string | undefined {
  const shown = JSON.stringify(args, null, 2);
  if (shown.length > MAX_SHOWN) return undefined;
  return `Morgan wants to use ${tool.name} (${tool.actionType}) with these arguments:\n${shown}`;
}

async function openQuestion(
  db: Db,
  call: { caller: Caller; tool: Described; args: Record<string, unknown> },
  expiresAtMs: number,
) {
  const { caller, tool, args } = call;
  const owner = await ownerOf(db, caller);
  const text = describeCall(tool, args);
  if (owner === undefined || text === undefined) return undefined;
  const expiresAt = new Date(expiresAtMs);
  const id = await createApproval(db, {
    owner,
    channel: caller.channel,
    chatId: caller.chatId,
    turnId: caller.turnId,
    tool: tool.name,
    argsSha256: approvalHash(tool.name, args),
    expiresAt,
  });
  return { id, text, expiresAt, owner };
}

export function createApprovals({
  db,
  prompt,
  closed,
  ttlMs,
  now = () => new Date(),
}: ApprovalsOptions): Approvals {
  const room = createWaitingRoom(db, ttlMs);

  return {
    request: async ({ caller, tool, args, signal }) => {
      if (signal?.aborted === true) return 'aborted';
      const question = await openQuestion(db, { caller, tool, args }, now().getTime() + ttlMs);
      if (question === undefined) return 'unavailable';
      const answered = room.wait(question.id, question.owner, signal);
      try {
        await prompt({ ...question, caller });
      } catch {
        room.cancel(question.id);
        await answered;
        return 'unavailable';
      }
      const answer = await answered;
      // Spent on this exact call, once; a late or reused approval finds nothing to spend.
      const spent =
        answer === 'approved' &&
        (await consumeApproval(db, question.owner, {
          id: question.id,
          argsSha256: approvalHash(tool.name, args),
          now: now(),
        }));
      const verdict = answer === 'approved' && !spent ? 'expired' : answer;
      // The chat is told what really happened: an approval that could not be spent is not "approved".
      await closed?.({ id: question.id, caller, outcome: verdict }).catch(() => undefined);
      return verdict;
    },
    decide: async (id, decision, from) => {
      const applied = await decideApproval(db, { id, decision, ...from, now: now() });
      if (applied) room.settle(id, decision);
      return applied;
    },
  };
}
