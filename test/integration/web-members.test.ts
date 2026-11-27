import { Writable } from 'node:stream';
import { sql } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createAccount, createInvite } from '../../src/data/index.js';
import { createApp } from '../../src/http/index.js';
import { sha256 } from '../../src/identity/admin-link.js';
import { createPasswordHasher } from '../../src/identity/password.js';
import { createLogger } from '../../src/ops/index.js';
import { startIsolation, type Isolation } from '../helpers/isolation.js';

let ctx: Isolation;
let app: ReturnType<typeof createApp>;
let logs = '';
const NEW_PASSWORD = 'a brand new password';
const TEMPORARY = 'temporary password 1';
const NOTICE = 'join.notice.admin_can_read';

beforeAll(async () => {
  ctx = await startIsolation();
  const sink = new Writable({
    write(chunk: Buffer, _encoding, done) {
      logs += chunk.toString();
      done();
    },
  });
  app = createApp({
    dbVersion: () => Promise.resolve('17'),
    logger: createLogger('trace', sink),
    auth: { db: ctx.app },
    // The chat routes too, so one walk covers every route under /api.
    chat: {
      events: {
        acknowledge: () => Promise.resolve(),
        eventsAfter: () => Promise.resolve([]),
        subscribe: () => () => undefined,
      },
      ingest: () => Promise.resolve(),
      decide: () => Promise.resolve(false),
    },
  });
}, 180_000);
afterAll(async () => {
  await ctx.stop();
});

const post = (path: string, body: unknown, cookie = '') =>
  app.request(`/api/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
const cookieOf = (response: Response) =>
  /morgan_session=[^;]+/.exec(response.headers.get('set-cookie') ?? '')?.[0] ?? '';
const invite = (token: string, monthlyLimitUsd: number | null = null) =>
  createInvite(ctx.app, ctx.alice, { tokenHash: sha256(token), ttlSeconds: 600, monthlyLimitUsd });

const OPEN = [
  '/api/sign-in',
  '/api/sign-in/second-factor',
  '/api/sign-in/passkey/options',
  '/api/sign-in/passkey',
  '/api/set-password',
  '/api/join',
];
const TEMPORARY_OK = ['/api/change-password', '/api/sign-out'];

/** Every registered route under /api: without a session only the open ones answer; on a temporary password only the two listed. */
async function expectEveryRouteGated(temporary: string): Promise<void> {
  const routes = app.routes.filter((r) => r.path.startsWith('/api') && r.method !== 'ALL');
  expect(routes.length).toBeGreaterThanOrEqual(5);
  for (const { method, path } of routes) {
    const call = (cookie: string) =>
      app.request(path, {
        method,
        headers: { 'content-type': 'application/json', cookie },
        ...(method === 'GET' ? {} : { body: '{}' }),
      });
    const anonymous = (await call('')).status;
    expect([path, anonymous === 401]).toEqual([path, !OPEN.includes(path)]);
    if (OPEN.includes(path) || TEMPORARY_OK.includes(path)) continue;
    expect([path, (await call(temporary)).status]).toEqual([path, 403]);
  }
}

it('joins by an invite once: the notice first, then role and limit land, signed in and told', async () => {
  await invite('tok-1', 7.5);
  const body = { token: 'tok-1', email: 'Joiner@example.test', password: NEW_PASSWORD };
  const refused = await post('join', { ...body, acceptedNotice: false });
  expect(refused.status).toBe(400);
  expect(await refused.json()).toEqual({ error: 'notice_required', notice: NOTICE });
  const joined = await post('join', { ...body, acceptedNotice: true });
  expect(joined.status).toBe(200);
  const me = await app.request('/api/me', { headers: { cookie: cookieOf(joined) } });
  expect(await me.json()).toMatchObject({ user: { role: 'member', email: 'joiner@example.test' } });
  const row = await ctx.owner
    .selectFrom('users')
    .innerJoin('budgets', 'budgets.user_id', 'users.id')
    .select('users.told_admin_can_read_at')
    .where('budgets.monthly_limit_usd', '=', '7.50')
    .executeTakeFirstOrThrow();
  expect(row.told_admin_can_read_at).toBeInstanceOf(Date);
  expect((await post('join', { ...body, acceptedNotice: true })).status).toBe(410);
  expect(logs).not.toContain('tok-1');
  await invite('tok-race');
  const race = { ...body, token: 'tok-race', acceptedNotice: true };
  const both = await Promise.all([
    post('join', { ...race, email: 'r1@example.test' }),
    post('join', { ...race, email: 'r2@example.test' }),
  ]);
  expect(both.map((r) => r.status).sort()).toEqual([200, 410]);
});

it('refuses an expired invite and a taken email, which leaves the invite unspent', async () => {
  await invite('tok-old');
  await sql`update invites set expires_at = now() - interval '1 second'
    where token_hash = ${sha256('tok-old')}`.execute(ctx.owner);
  const base = { password: NEW_PASSWORD, acceptedNotice: true };
  expect(
    (await post('join', { token: 'tok-old', email: 'late@example.test', ...base })).status,
  ).toBe(410);
  await invite('tok-2');
  const clash = { token: 'tok-2', email: 'a@example.test', ...base };
  expect((await post('join', clash)).status).toBe(409);
  expect((await post('join', { ...clash, email: 'free@example.test' })).status).toBe(200);
});

it('lets a temporary-password account call only the listed paths', async () => {
  const passwordHash = await createPasswordHasher().hash(TEMPORARY);
  const account = { email: 'temp@example.test', passwordHash, monthlyLimitUsd: 3 };
  expect(await createAccount(ctx.app, ctx.alice, account)).toBeDefined();
  const signedIn = await post('sign-in', { email: 'temp@example.test', password: TEMPORARY });
  const cookie = cookieOf(signedIn);
  expect(signedIn.status).toBe(200);
  const blocked = await app.request('/api/me', { headers: { cookie } });
  expect(blocked.status).toBe(403);
  expect(await blocked.json()).toEqual({ error: 'password_change_required' });
  await expectEveryRouteGated(cookie);
  expect(logs).not.toContain(TEMPORARY);
});

it('limits dead invite tries per address', async () => {
  const dead = { token: 'dead', email: 'n@example.test', password: NEW_PASSWORD };
  let status = 0;
  for (let i = 0; i < 25 && status !== 429; i++) {
    status = (await post('join', { ...dead, acceptedNotice: true })).status;
  }
  expect(status).toBe(429);
});
