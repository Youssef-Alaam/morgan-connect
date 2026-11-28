import { appendAudit, routeEnabled, type Db, type Turn } from '../data/index.js';
import type { Logger } from '../ops/index.js';
import { ROUTE_OFF_REPLY, type Gate } from '../policy/index.js';

export { ROUTE_OFF_REPLY };

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/**
 * Before the model is called: may this route be used (terms policy file, M3-2a) and has the admin
 * switched it off (M2-15e)? Either: record the refusal and answer with the sentence. No model call
 * is made. A route nobody named is not checked. With the gate, it makes both checks; without one,
 * only the admin's switch is read. The switch is read once per turn, here: a compaction already
 * running when the admin switches the route off is not stopped.
 */
export async function refusedForRoute(
  deps: {
    db: Db;
    logger: Logger;
    route?: string | undefined;
    gate?: Pick<Gate, 'refuseModelCall'> | undefined;
  },
  turn: Turn,
): Promise<string | undefined> {
  if (deps.route === undefined) return undefined;
  if (deps.gate !== undefined) {
    const { channel, chatId, id: turnId } = turn;
    return deps.gate.refuseModelCall({ channel, chatId, turnId }, deps.route);
  }
  if (await routeEnabled(deps.db, deps.route)) return undefined;
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
