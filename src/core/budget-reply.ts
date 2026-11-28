import { appendAudit, type Db, type Turn } from '../data/index.js';
import type { Logger } from '../ops/index.js';
import { refusedForRoute } from './route-reply.js';
import { checkBudget, type KeySource } from '../policy/index.js';

export const BUDGET_REPLY = "You've reached this month's limit.";

/** What to send back: text, or text with an "Ask for more" button (the limit was reached). */
export type ReplyResult = string | { text: string; askMore: true };

export interface BudgetSettings {
  keySource: KeySource;
  /** For a person with no limit of their own. Unset: no limit. */
  defaultLimitUsd?: string | undefined;
}

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/**
 * Before the model is called: is this person over their monthly limit? Yes: record the refusal and
 * answer with the fixed line. No model call is made, so it costs nothing.
 */
export async function refusedForBudget(
  deps: {
    db: Db;
    logger: Logger;
    timezone: string;
    budget?: BudgetSettings | undefined;
    now?: (() => Date) | undefined;
  },
  turn: Turn,
): Promise<ReplyResult | undefined> {
  if (deps.budget === undefined) return undefined;
  const owner = { userId: turn.userId, workspaceId: turn.workspaceId };
  const verdict = await checkBudget(deps.db, owner, {
    ...deps.budget,
    timezone: deps.timezone,
    now: (deps.now ?? (() => new Date()))(),
  });
  if (verdict.allowed) return undefined;
  try {
    await appendAudit(deps.db, {
      turnId: turn.id,
      channel: turn.channel,
      chatId: turn.chatId,
      tool: 'budget.monthly',
      actionType: 'model',
      changesState: false,
      argNames: [],
      extraArgs: 0,
      argsSha256: EMPTY_SHA256,
      decision: 'off',
      outcome: 'refused',
    });
  } catch {
    deps.logger.warn({ turnId: turn.id }, 'budget refusal not audited');
  }
  return { text: BUDGET_REPLY, askMore: true };
}

/** The checks before any model call, in order: the route is on, then the person is within their limit. */
export async function refusedBeforeModel(
  deps: Parameters<typeof refusedForBudget>[0] & { route?: string | undefined },
  turn: Turn,
): Promise<ReplyResult | undefined> {
  return (await refusedForRoute(deps, turn)) ?? (await refusedForBudget(deps, turn));
}
