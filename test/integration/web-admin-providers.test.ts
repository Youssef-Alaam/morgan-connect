import { sql } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createSession, routeEnabled, type Owner } from '../../src/data/index.js';
import { createApp } from '../../src/http/index.js';
import { sha256 } from '../../src/identity/admin-link.js';
import { createLogger } from '../../src/ops/index.js';
import { startIsolation, type Isolation } from '../helpers/isolation.js';

// The providers and channels page (M2-15e), through the real routes.
const KEY = 'sk-ant-api03-FIXTURE-SECRET-VALUE-wxyz';
let ctx: Isolation;
let app: ReturnType<typeof createApp>;
let admin = '';
let member = '';

beforeAll(async () => {
  ctx = await startIsolation();
  app = createApp({
    dbVersion: () => Promise.resolve('17'),
    logger: createLogger('silent'),
    auth: {
      db: ctx.app,
      providers: {
        routes: [{ id: 'anthropic', provider: 'Anthropic', model: 'm-1', keyLast4: 'wxyz' }],
        telegram: true,
      },
    },
  });
  const cookieFor = async (who: Owner, token: string) => {
    await createSession(ctx.app, who, {
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    return `morgan_session=${token}`;
  };
  admin = await cookieFor(ctx.alice, 'admin-tok');
  member = await cookieFor(ctx.bob, 'member-tok');
}, 180_000);
afterAll(async () => {
  await ctx.stop();
});

const call = (method: string, path: string, cookie: string, body?: unknown) =>
  app.request(`/api/${path}`, {
    method,
    headers: { 'content-type': 'application/json', cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const audits = async (tool: string, outcome: string): Promise<number> => {
  const { rows } = await sql<{ n: string }>`select count(*) as n from audit_log
    where tool = ${tool} and outcome = ${outcome}`.execute(ctx.owner);
  return Number(rows[0]?.n);
};

it('shows the route with the last four characters of its key and never the key', async () => {
  const res = await call('GET', 'admin/providers', admin);
  const text = await res.text();
  expect(res.status).toBe(200);
  expect(JSON.parse(text)).toMatchObject({
    routes: [{ id: 'anthropic', provider: 'Anthropic', model: 'm-1', keyLast4: 'wxyz' }],
  });
  expect(text).not.toContain(KEY);
  expect(text).not.toContain(KEY.slice(0, -4));
  expect(text).not.toContain('FIXTURE');
});

it('lists the channels with the last message each received', async () => {
  await ctx.owner
    .insertInto('turns')
    .values({
      user_id: ctx.alice.userId,
      workspace_id: ctx.alice.workspaceId,
      idempotency_key: 'tg-1',
      channel: 'telegram',
      chat_id: 'tg',
      text: 'hi',
    })
    .execute();
  const body = (await (await call('GET', 'admin/providers', admin)).json()) as {
    channels: { id: string; configured: boolean; lastMessageAt: string | null }[];
  };
  const find = (id: string) => body.channels.find((c) => c.id === id);
  expect(find('telegram')).toMatchObject({ configured: true });
  expect(find('telegram')?.lastMessageAt).toEqual(expect.any(String));
  expect(find('web')).toMatchObject({ configured: true, lastMessageAt: null });
});

it('refuses a member, and audits it', async () => {
  const before = await audits('admin.providers.list', 'refused');
  expect((await call('GET', 'admin/providers', member)).status).toBe(403);
  expect(await audits('admin.providers.list', 'refused')).toBe(before + 1);
  const set = await call('PUT', 'admin/providers/anthropic', member, { enabled: false });
  expect(set.status).toBe(403);
  expect(await routeEnabled(ctx.app, 'anthropic')).toBe(true);
  expect(await audits('admin.route.set', 'refused')).toBe(1);
});

it('switches a route off and on, each time with an audit row', async () => {
  expect((await call('PUT', 'admin/providers/anthropic', admin, { enabled: false })).status).toBe(
    204,
  );
  expect(await routeEnabled(ctx.app, 'anthropic')).toBe(false);
  const page = (await (await call('GET', 'admin/providers', admin)).json()) as {
    routes: { enabled: boolean }[];
  };
  expect(page.routes[0]?.enabled).toBe(false);
  await call('PUT', 'admin/providers/anthropic', admin, { enabled: true });
  expect(await routeEnabled(ctx.app, 'anthropic')).toBe(true);
  expect(await audits('admin.route.set', 'ok')).toBe(2);
});

it('answers 404 for a route that is not configured and 400 for a bad body', async () => {
  expect((await call('PUT', 'admin/providers/other', admin, { enabled: false })).status).toBe(404);
  expect((await call('PUT', 'admin/providers/anthropic', admin, { enabled: 'no' })).status).toBe(
    400,
  );
  expect(await routeEnabled(ctx.app, 'other')).toBe(true);
});

it('gives a member no way to write the table directly', async () => {
  await expect(
    sql`insert into routes (id, enabled) values ('anthropic', false)`.execute(ctx.app),
  ).rejects.toThrow();
});
