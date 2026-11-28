import { appendAudit, routeEnabled, type Db, type Turn } from '../data/index.js';
import type { Logger } from '../ops/index.js';

export const ROUTE_OFF_REPLY =
  'This assistant is switched off right now. Your admin can switch it back on.';

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/**
 * Before the model is called: has the admin switched this route off (M2-15e)? Yes: record the
 * refusal and answer with the fixed line. No model call is made. A route nobody named is not checked.
 * The switch is read once per turn, here: a compaction already running when the admin switches
 * the route off is not stopped.
 */
export async function refusedForRoute(
  deps: { db: Db; logger: Logger; route?: string | undefined },
  turn: Turn,
): Promise<string | undefined> {
  if (deps.route === undefined || (await routeEnabled(deps.db, deps.route))) return undefined;
  try {
    await appendAudit(deps.db, {
      turnId: turn.id,
      channel: turn.channel,
      chatId: turn.chatId,
      tool: 'route.switched_off',
      actionType: 'model',
      changesState: false,
      argNames: [],
      extraArgs: 0,
      argsSha256: EMPTY_SHA256,
      decision: 'off',
      outcome: 'refused',
    });
  } catch {
    deps.logger.warn({ turnId: turn.id }, 'route refusal not audited');
  }
  return ROUTE_OFF_REPLY;
}
