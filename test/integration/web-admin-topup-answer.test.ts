import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  createSession,
  recordUsage,
  setBudget,
  topupTotal,
  type Owner,
} from '../../src/data/index.js';
import { createApp } from '../../src/http/index.js';
import { sha256 } from '../../src/identity/admin-link.js';
import { createLogger } from '../../src/ops/index.js';
import { createTopups, type Topups } from '../../src/policy/index.js';
import { startIsolation, type Isolation } from '../helpers/isolation.js';

let ctx: Isolation;
let app: ReturnType<typeof createApp>;
let topups: Topups;
let admin = '';
let member = '';
let asked: string[] = [];
let told: string[] = [];
let tellFails = false;
const month = new Date().toISOString().slice(0, 7);
/** What was approved for Bob before these tests; the seed already has some. */
let base = 0;
const total = async (): Promise<number> => Number(await topupTotal(ctx.app, ctx.bob, month));

beforeAll(async () => {
  ctx = await startIsolation();
  app = createApp({
    dbVersion: () => Promise.resolve('17'),
    logger: createLogger('silent'),
    auth: {
      db: ctx.app,
      tellMember: (_channel, _chat, text) => {
        told.push(text);
        return tellFails ? Promise.reject(new Error('down')) : Promise.resolve();
      },
    },
  });
  topups = createTopups({
    db: ctx.app,
    amountUsd: '5',
    keySource: 'admin',
    timezone: 'UTC',
    ttlMs: 60_000,
    adminChannel: 'fake',
    askAdmin: (_chat, _text, approvalId) => {
      asked.push(approvalId);
      return Promise.resolve();
    },
    tell: () => Promise.resolve(),
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
  await setBudget(ctx.owner, ctx.alice, ctx.bob.userId, '0');
  await recordUsage(ctx.owner, {
    ...ctx.bob,
    channel: 'fake',
    chatId: 'b',
    model: 'm',
    status: 'ok',
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 1000,
  });
  base = await total();
}, 180_000);
afterAll(async () => {
  await ctx.stop();
});
beforeEach(async () => {
  asked = [];
  told = [];
  tellFails = false;
  await sql`update budget_topups set status = 'cancelled' where status = 'open'`.execute(ctx.owner);
});

const answer = (cookie: string, id: string, decision: unknown) =>
  app.request(`/api/admin/topups/${id}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ decision }),
  });
const ask = async (): Promise<string> => {
  expect(await topups.ask({ channel: 'fake', chatId: 'b' })).toBe('sent');
  return (
    await ctx.owner
      .selectFrom('budget_topups')
      .select('id')
      .where('status', '=', 'open')
      .executeTakeFirstOrThrow()
  ).id;
};
const audits = () =>
  sql<{ outcome: string }>`select outcome from audit_log where tool = 'admin.budget.topup'
    and channel = 'web' order by id`
    .execute(ctx.owner)
    .then((result) => result.rows.map((row) => row.outcome));
const telegramTap = () =>
  topups.decide({ id: asked.at(-1) ?? '', decision: 'approved', channel: 'fake', chatId: 'a' });

it('approves from the page once: raises the month, tells the member, Telegram cannot repeat it', async () => {
  const id = await ask();
  const done = await answer(admin, id, 'approved');
  expect(done.status).toBe(200);
  expect(await done.json()).toEqual({ amountUsd: '5.00000000', decision: 'approved' });
  expect(told).toEqual(["$5.00 was added to this month's limit. Carry on."]);
  expect(await total()).toBe(base + 5);
  expect(await telegramTap()).toBeUndefined();
  expect((await answer(admin, id, 'approved')).status).toBe(404);
  expect(await total()).toBe(base + 5);
  const approval = await ctx.owner
    .selectFrom('approvals')
    .select('status')
    .where('id', '=', asked.at(-1) ?? '')
    .executeTakeFirstOrThrow();
  expect(approval.status).toBe('used');
});

it('lets Telegram win when it answers first: the page then finds it closed', async () => {
  const id = await ask();
  expect(await telegramTap()).toBe(true);
  expect((await answer(admin, id, 'approved')).status).toBe(404);
  expect(await total()).toBe(base + 10);
});

it('records a refusal, and a failed reply to the member does not undo it', async () => {
  const id = await ask();
  tellFails = true;
  expect((await answer(admin, id, 'refused')).status).toBe(200);
  expect(told).toEqual(['The admin said no to more this month.']);
  expect(await total()).toBe(base + 10);
  expect(await telegramTap()).toBeUndefined();
  expect((await audits()).slice(-1)).toEqual(['denied']);
});

it('refuses a member and audits it; bad input is 400; a lapsed request is 404', async () => {
  const id = await ask();
  const before = (await audits()).length;
  expect((await answer(member, id, 'approved')).status).toBe(403);
  expect((await answer(member, 'nope', 'approved')).status).toBe(403);
  expect((await audits()).slice(before)).toEqual(['refused']);
  expect((await answer('', id, 'approved')).status).toBe(401);
  expect((await answer(admin, id, 'maybe')).status).toBe(400);
  expect((await answer(admin, 'nope', 'approved')).status).toBe(400);
  await sql`update budget_topups set expires_at = now() - interval '1 minute'`.execute(ctx.owner);
  expect((await answer(admin, id, 'approved')).status).toBe(404);
  expect(told).toEqual([]);
  expect(await total()).toBe(base + 10);
});
