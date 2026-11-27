import { sql } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createSession, setBudget, type Owner } from '../../src/data/index.js';
import { createApp } from '../../src/http/index.js';
import { sha256 } from '../../src/identity/admin-link.js';
import { createLogger } from '../../src/ops/index.js';
import { createTopups } from '../../src/policy/index.js';
import { startIsolation, type Isolation } from '../helpers/isolation.js';

let ctx: Isolation;
let app: ReturnType<typeof createApp>;
let admin = '';
let member = '';
const asked: string[] = [];

beforeAll(async () => {
  ctx = await startIsolation();
  app = createApp({
    dbVersion: () => Promise.resolve('17'),
    logger: createLogger('silent'),
    auth: { db: ctx.app },
  });
  const cookieFor = async (who: Owner, token: string) => {
    await createSession(ctx.app, who, {
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + 86_400_000),
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
const step = (cookie: string, id: string, amountUsd: unknown) =>
  call('PUT', `admin/people/${id}/topup-step`, cookie, { amountUsd });
const audits = () =>
  sql<{ outcome: string }>`select outcome from audit_log where tool = 'admin.topup_step.set'
    order by id`
    .execute(ctx.owner)
    .then((result) => result.rows.map((row) => row.outcome));

/** Bob is over a 1 dollar limit and asks, in the chat the question will be sent to. */
const bobAsks = () =>
  createTopups({
    db: ctx.app,
    amountUsd: '5',
    keySource: 'admin',
    timezone: 'UTC',
    ttlMs: 60_000,
    adminChannel: 'fake',
    askAdmin: (_chat, text) => {
      asked.push(text);
      return Promise.resolve();
    },
    tell: () => Promise.resolve(),
  }).ask({ channel: 'fake', chatId: 'b' });

it('asks for the person own step when the admin set one, else the install step', async () => {
  await setBudget(ctx.owner, ctx.alice, ctx.bob.userId, '0');
  expect(await bobAsks()).toBe('sent');
  expect(asked.at(-1)).toContain('Add $5.00');
  await sql`update budget_topups set status = 'cancelled'`.execute(ctx.owner);
  expect((await step(admin, ctx.bob.userId, '12.5')).status).toBe(204);
  expect(await bobAsks()).toBe('sent');
  expect(asked.at(-1)).toContain('Add $12.50');
  const sheet = (await (await call('GET', 'admin/budgets', admin)).json()) as {
    people: { id: string; topupStepUsd?: string }[];
  };
  expect(sheet.people.find((p) => p.id === ctx.bob.userId)?.topupStepUsd).toBe('12.50000000');
  await sql`update budget_topups set status = 'cancelled'`.execute(ctx.owner);
  expect((await step(admin, ctx.bob.userId, null)).status).toBe(204);
  expect(await bobAsks()).toBe('sent');
  expect(asked.at(-1)).toContain('Add $5.00');
});

it('lists the requests still waiting, for the admin only', async () => {
  const answer = await call('GET', 'admin/topups', admin);
  const { topups } = (await answer.json()) as {
    topups: { memberId: string; amountUsd: string; email?: string }[];
  };
  expect(topups).toHaveLength(1);
  expect(topups[0]).toMatchObject({ memberId: ctx.bob.userId, amountUsd: '5.00000000' });
  expect(topups[0]?.email).toBe('b@example.test');
  expect((await call('GET', 'admin/topups', member)).status).toBe(403);
  expect((await call('GET', 'admin/topups', '')).status).toBe(401);
  await sql`update budget_topups set status = 'expired'`.execute(ctx.owner);
  const after = (await (await call('GET', 'admin/topups', admin)).json()) as { topups: unknown[] };
  expect(after.topups).toEqual([]);
});

it('refuses a member, bad amounts and strangers, and audits the attempts', async () => {
  const before = (await audits()).length;
  expect((await step(member, ctx.bob.userId, '99')).status).toBe(403);
  expect((await step(admin, ctx.bob.userId, '0')).status).toBe(400);
  expect((await step(admin, ctx.bob.userId, '-2')).status).toBe(400);
  expect((await step(admin, ctx.bob.userId, 5)).status).toBe(400);
  expect((await step(admin, 'nope', '5')).status).toBe(400);
  const gone = '99999999-9999-4999-8999-999999999999';
  expect((await step(admin, gone, '5')).status).toBe(404);
  expect((await audits()).slice(before)).toEqual(['refused', 'refused']);
  const row = await ctx.owner
    .selectFrom('users')
    .select('topup_amount_usd')
    .where('id', '=', ctx.bob.userId)
    .executeTakeFirstOrThrow();
  expect(row.topup_amount_usd).toBeNull();
});
