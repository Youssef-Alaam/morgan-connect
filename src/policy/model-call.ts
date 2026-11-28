import { appendAudit, routeEnabled, type Db } from '../data/index.js';
import type { Logger } from '../ops/index.js';
import type { Caller } from './recorder.js';
import { DEFAULT_ROUTES_FILE, findRoute, loadRoutePolicy, routeAllowed } from './routes.js';

/** What a person is told when the admin has switched the route off (M2-15e). */
export const ROUTE_OFF_REPLY =
  'This assistant is switched off right now. Your admin can switch it back on.';

/**
 * Routes that reach the install's own engine endpoint, not a provider: there are no provider terms
 * to record, so only the admin's switch applies to them.
 */
const SELF_HOSTED_ROUTES: readonly string[] = ['http'];

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export interface ModelCallCheckOptions {
  db: Db;
  logger?: Pick<Logger, 'error'> | undefined;
  now?: (() => Date) | undefined;
  /** The terms policy file. Default: `policy/routes.json`. */
  routesFile?: string | undefined;
  /** Has the admin opted in to this grey route? Nothing records that yet, so by default no. */
  optedIn?: ((route: string) => boolean) | undefined;
}

/**
 * The check before every model call, engine or safety model: both locks must say on.
 * First the terms policy file (verdict, opt-in, 90 days), then the admin's switch in `routes`.
 * Returns the sentence to tell the person, or undefined when the call may go ahead. A refusal
 * writes one audit row; a file that cannot be read refuses everything (fail closed).
 */
export function createModelCallCheck(
  options: ModelCallCheckOptions,
): (caller: Caller, route: string) => Promise<string | undefined> {
  const { db, logger } = options;
  const now = options.now ?? ((): Date => new Date());
  const file = options.routesFile ?? DEFAULT_ROUTES_FILE;

  const refuse = async (caller: Caller, tool: string, reply: string): Promise<string> => {
    try {
      await appendAudit(db, {
        ...caller,
        tool,
        actionType: 'model',
        changesState: false,
        argNames: [],
        extraArgs: 0,
        argsSha256: EMPTY_SHA256,
        decision: 'off',
        outcome: 'refused',
      });
    } catch {
      logger?.error({ tool }, 'model call refusal not audited');
    }
    return reply;
  };

  const termsRefusal = (route: string): string | undefined => {
    if (SELF_HOSTED_ROUTES.includes(route)) return undefined;
    try {
      const listed = findRoute(loadRoutePolicy(file), route);
      if (listed === undefined)
        return `The ${route} route is not in the terms policy file, so it is switched off.`;
      const verdict = routeAllowed(listed, now(), options.optedIn?.(route) ?? false);
      return verdict.ok ? undefined : verdict.reason;
    } catch {
      return 'The terms policy file could not be read, so every model route is switched off.';
    }
  };

  return async (caller, route) => {
    const terms = termsRefusal(route);
    if (terms !== undefined) return refuse(caller, 'route.terms_refused', terms);
    if (!(await routeEnabled(db, route)))
      return refuse(caller, 'route.switched_off', ROUTE_OFF_REPLY);
    return undefined;
  };
}
