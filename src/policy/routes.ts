import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** The terms policy file (ADR-0004): one row per provider route, at the repository root. */
export const DEFAULT_ROUTES_FILE = fileURLToPath(
  new URL('../../policy/routes.json', import.meta.url),
);

/** A route unverified for longer than this switches itself off (A12). */
const MAX_AGE_DAYS = 90;
const DAY_MS = 86_400_000;

const isRealDate = (value: string): boolean => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
};

const routeSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  /** What a person is told the route is called. */
  label: z.string().min(1),
  verdict: z.enum(['allowed', 'grey', 'off']),
  source: z.url(),
  verified: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(isRealDate, 'not a real date'),
});

const policySchema = z.strictObject({ routes: z.array(routeSchema).min(1) });

export type PolicyRoute = z.infer<typeof routeSchema>;
export interface RoutePolicy {
  routes: PolicyRoute[];
}
export type RouteVerdict = { ok: true } | { ok: false; reason: string };

/** The file's text as a checked policy. Throws, naming the field, on anything incomplete. */
export function parseRoutePolicy(text: string): RoutePolicy {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('The terms policy file is not valid JSON.');
  }
  const parsed = policySchema.safeParse(json);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'file'}: ${issue.message}`)
      .join('; ');
    throw new Error(`The terms policy file is invalid (${detail}).`);
  }
  const ids = new Set<string>();
  for (const { id } of parsed.data.routes) {
    if (ids.has(id)) throw new Error(`The terms policy file lists the route ${id} twice.`);
    ids.add(id);
  }
  return parsed.data;
}

/** Read and check the file. Read on every model call, so editing it needs no release. */
export function loadRoutePolicy(path: string = DEFAULT_ROUTES_FILE): RoutePolicy {
  return parseRoutePolicy(readFileSync(path, 'utf8'));
}

export function findRoute(policy: RoutePolicy, id: string): PolicyRoute | undefined {
  return policy.routes.find((route) => route.id === id);
}

const startOfDay = (date: Date): number => Math.floor(date.getTime() / DAY_MS);

/**
 * May this route be used now? Off by verdict, grey without the admin's opt-in, or not verified
 * within 90 days (counted in UTC days). The reason names the route and says why.
 */
export function routeAllowed(route: PolicyRoute, now: Date, optedIn = false): RouteVerdict {
  const off = (why: string): RouteVerdict => ({
    ok: false,
    reason: `The ${route.label} route is switched off: ${why}`,
  });
  if (route.verdict === 'off') return off('the terms policy file has it off.');
  if (route.verdict === 'grey' && !optedIn) {
    return off('it is a grey route and the admin has not opted in.');
  }
  const age = startOfDay(now) - startOfDay(new Date(`${route.verified}T00:00:00Z`));
  if (age < 0) return off(`its last-verified date (${route.verified}) is in the future.`);
  if (age > MAX_AGE_DAYS) {
    return off(
      `its terms were last verified ${String(age)} days ago (${route.verified}), and a route is not used after ${String(MAX_AGE_DAYS)} days without a check.`,
    );
  }
  return { ok: true };
}
