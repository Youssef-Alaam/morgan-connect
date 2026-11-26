import { Writable } from 'node:stream';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createApp } from '../../src/http/index.js';
import { announceAdminLink } from '../../src/identity/index.js';
import { createLogger } from '../../src/ops/index.js';
import { startIsolation, type Isolation } from '../helpers/isolation.js';

const PASSWORD = 'correct horse battery';
let ctx: Isolation;
let clock = Date.now();
let app: ReturnType<typeof createApp>;
let logs = '';

beforeAll(async () => {
  ctx = await startIsolation();
  // The shared seed gives everyone a login; this file starts from an install with none.
  await ctx.owner.deleteFrom('credentials').execute();
  await ctx.owner.deleteFrom('password_links').execute();
  const sink = new Writable({
    write(chunk: Buffer, _encoding, done) {
      logs += chunk.toString();
      done();
    },
  });
  const logger = createLogger('trace', sink);
  // Runs as the app role under forced row-level security: every handler must go through withOwner.
  app = createApp({
    dbVersion: () => Promise.resolve('17'),
    logger,
    auth: { db: ctx.app, now: () => clock },
  });
  await announceAdminLink(ctx.app, logger, 'https://morgan.test');
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
const signIn = (password = PASSWORD) => post('sign-in', { email: 'Admin@Example.test', password });
const cookieOf = (response: Response) =>
  /morgan_session=[^;]+/.exec(response.headers.get('set-cookie') ?? '')?.[0] ?? '';

it('prints a link once; it sets the password once, and a second use is refused', async () => {
  const token = /#token=([\w-]+)/.exec(logs)?.[1] ?? '';
  expect(token).not.toBe('');
  const body = { token, email: 'Admin@Example.test', password: PASSWORD };
  expect((await post('set-password', { ...body, password: 'short' })).status).toBe(400);
  expect((await post('set-password', body)).status).toBe(200);
  expect((await post('set-password', body)).status).toBe(410);
  expect(await announceAdminLink(ctx.app, createLogger('silent'), 'https://morgan.test')).toBe(
    false,
  );
});

it('refuses an expired link', async () => {
  const { owner, bob } = ctx;
  const row = { user_id: bob.userId, workspace_id: bob.workspaceId, used_at: null };
  await owner
    .insertInto('password_links')
    .values({ ...row, token_hash: 'x'.repeat(64), expires_at: new Date(0) })
    .execute();
  expect(
    (await post('set-password', { token: 'x', email: 'bob@example.test', password: PASSWORD }))
      .status,
  ).toBe(410);
});

it('signs in with a Secure HttpOnly Lax cookie, and /api/me returns the user and workspace', async () => {
  expect((await app.request('/api/me')).status).toBe(401);
  const response = await signIn();
  expect(response.status).toBe(200);
  expect(response.headers.get('set-cookie')).toMatch(/HttpOnly/i);
  expect(response.headers.get('set-cookie')).toMatch(/Secure/i);
  expect(response.headers.get('set-cookie')).toMatch(/SameSite=Lax/i);
  const cookie = cookieOf(response);
  const me = await app.request('/api/me', { headers: { cookie } });
  expect(await me.json()).toMatchObject({
    user: { id: ctx.alice.userId, role: 'admin', email: 'admin@example.test' },
    workspace: { id: ctx.alice.workspaceId, name: 'Default' },
  });
  const devices = await ctx.owner
    .selectFrom('devices')
    .select('channel')
    .where('channel', '=', 'web')
    .execute();
  expect(devices).toHaveLength(1);
  expect((await post('sign-out', {}, cookie)).status).toBe(204);
  expect((await app.request('/api/me', { headers: { cookie } })).status).toBe(401);
  expect(
    (await app.request('/api/me', { headers: { cookie: 'morgan_session=nope' } })).status,
  ).toBe(401);
});

it('refuses a wrong password, then rate-limits even the right one until the window passes', async () => {
  expect((await signIn('wrong password here')).status).toBe(401);
  expect((await post('sign-in', { email: 'nobody@example.test', password: PASSWORD })).status).toBe(
    401,
  );
  for (let i = 0; i < 4; i++) await signIn('wrong password here');
  expect((await signIn('wrong password here')).status).toBe(429);
  expect((await signIn()).status).toBe(429);
  clock += 16 * 60 * 1000;
  expect((await signIn()).status).toBe(200);
});

it('refuses a link whose email is taken and a malformed body', async () => {
  expect((await post('sign-in', 'nope')).status).toBe(400);
  const { owner, bob } = ctx;
  const row = { user_id: bob.userId, workspace_id: bob.workspaceId, used_at: null };
  const token = 'taken';
  const { sha256 } = await import('../../src/identity/admin-link.js');
  await owner
    .insertInto('password_links')
    .values({ ...row, token_hash: sha256(token), expires_at: new Date(Date.now() + 60_000) })
    .execute();
  const response = await post('set-password', {
    token,
    email: 'admin@example.test',
    password: PASSWORD,
  });
  expect(response.status).toBe(409);
});

it('never logs a password or a session token', () => {
  expect(logs).toContain('web sign-in');
  expect(logs).not.toContain(PASSWORD);
  expect(logs).not.toContain('wrong password here');
  expect(logs).not.toMatch(/morgan_session/);
});
