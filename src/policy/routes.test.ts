import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROUTES_FILE,
  findRoute,
  loadRoutePolicy,
  parseRoutePolicy,
  routeAllowed,
  type PolicyRoute,
  type RouteVerdict,
} from './routes.js';

const row = {
  id: 'anthropic',
  label: 'Anthropic API key',
  verdict: 'allowed',
  source: 'https://example.com/terms',
  verified: '2026-11-24',
};
const reasonOf = (verdict: RouteVerdict): string => (verdict.ok ? '' : verdict.reason);
const file = (...rows: Record<string, unknown>[]): string => JSON.stringify({ routes: rows });

describe('parseRoutePolicy', () => {
  it('accepts a complete row', () => {
    expect(parseRoutePolicy(file(row)).routes).toEqual([row]);
  });
  it.each(['source', 'verified', 'verdict', 'label', 'id'])('refuses a row with no %s', (key) => {
    const rest = Object.fromEntries(Object.entries(row).filter(([name]) => name !== key));
    expect(() => parseRoutePolicy(file(rest))).toThrow(new RegExp(key));
  });
  it('refuses an unknown verdict, a bad date and a source that is not a link', () => {
    expect(() => parseRoutePolicy(file({ ...row, verdict: 'maybe' }))).toThrow(/verdict/);
    expect(() => parseRoutePolicy(file({ ...row, verified: '2026-02-30' }))).toThrow(/verified/);
    expect(() => parseRoutePolicy(file({ ...row, verified: 'yesterday' }))).toThrow(/verified/);
    expect(() => parseRoutePolicy(file({ ...row, source: 'see the website' }))).toThrow(/source/);
  });
  it('refuses a repeated id, an empty list and text that is not JSON', () => {
    expect(() => parseRoutePolicy(file(row, row))).toThrow(/twice/);
    expect(() => parseRoutePolicy(file())).toThrow(/routes/);
    expect(() => parseRoutePolicy('{nope')).toThrow(/not valid JSON/);
  });
});

describe('the shipped policy file', () => {
  it('loads, and lists the Anthropic API-key route as allowed with a source and a date', () => {
    const policy = loadRoutePolicy(DEFAULT_ROUTES_FILE);
    expect(policy.routes.map((route) => [route.id, route.verdict])).toEqual([
      ['anthropic', 'allowed'],
    ]);
    expect(findRoute(policy, 'anthropic')?.source).toMatch(/^https:\/\//);
    expect(findRoute(policy, 'anthropic')?.verified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('routeAllowed (A12: unverified for 90 days switches itself off)', () => {
  const route = (patch: Partial<PolicyRoute> = {}): PolicyRoute => ({
    ...(row as PolicyRoute),
    verified: '2026-08-30',
    ...patch,
  });
  const now = new Date('2026-11-28T15:30:00Z');

  it('works when verified 90 days ago and is off when verified 91 days ago', () => {
    expect(routeAllowed(route({ verified: '2026-08-30' }), now)).toEqual({ ok: true });
    const stale = routeAllowed(route({ verified: '2026-08-29' }), now);
    expect(reasonOf(stale)).toMatch(/Anthropic API key.*91 days ago/);
  });
  it('is off when the verdict is off, and says so', () => {
    const verdict = routeAllowed(route({ verdict: 'off' }), now);
    expect(reasonOf(verdict)).toMatch(/Anthropic API key.*switched off/);
  });
  it('keeps a grey route off unless the admin opted in', () => {
    expect(reasonOf(routeAllowed(route({ verdict: 'grey' }), now))).toMatch(/grey.*opt/);
    expect(routeAllowed(route({ verdict: 'grey' }), now, true)).toEqual({ ok: true });
  });
  it('still applies the 90 days to an opted-in grey route', () => {
    expect(routeAllowed(route({ verdict: 'grey', verified: '2026-01-01' }), now, true).ok).toBe(
      false,
    );
  });
  it('refuses a date in the future', () => {
    expect(routeAllowed(route({ verified: '2026-12-01' }), now).ok).toBe(false);
  });
});

describe('findRoute', () => {
  it('finds a route by id and returns nothing for an unlisted one', () => {
    const policy = parseRoutePolicy(file(row));
    expect(findRoute(policy, 'anthropic')?.id).toBe('anthropic');
    expect(findRoute(policy, 'other')).toBeUndefined();
  });
});
