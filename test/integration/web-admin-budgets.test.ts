import { sql } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createSession, recordUsage, type Owner } from '../../src/data/index.js';
import { createApp } from '../../src/http/index.js';
import { sha256 } from '../../src/identity/admin-link.js';
import { createLogger } from '../../src/ops/index.js';
import { startIsolation, type Isolation } from '../helpers/isolation.js';

let ctx: Isolation;
let app: ReturnType<typeof createApp>;
let admin = '';
let member = '';
// 22:30 UTC on 30 Nov is already 1 December in Cairo (UTC+2): the month boundary under test.
let clock = Date.parse('2026-11-30T21:00:00Z');

beforeAll(async () => {
  ctx = await startIsolation();
  app = createApp({
    dbVersion: () => Promise.resolve('17'),
    logger: createLogger('silent'),
    auth: {
      db: ctx.app,
      now: () => clock,
      budgets: { timezone: 'Africa/Cairo', defaultLimitUsd: '3', topupAmountUsd: '5' },
    },
  });
  const cookieFor = async (who: Owner, token: string) => {
    await createSession(ctx.app, who, {
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + 86_400_000 * 365),
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
const audits = (tool: string) =>
  sql<{ outcome: string }>`select outcome from audit_log where tool = ${tool} order by id`
    .execute(ctx.owner)
    .then((result) => result.rows.map((row) => row.outcome));

interface Summary {
  month: string;
  defaults: { limitUsd: string | null; topupUsd: string | null };
  people: {
    id: string;
    role: string;
    limitUsd?: string;
    taskCap?: number;
    topupStepUsd?: string;
    topupUsd: string;
    spentUsd: string;
    calls: number;
  }[];
}
const bob = async (): Promise<Summary['people'][number] | undefined> => {
  const { people } = (await (await call('GET', 'admin/budgets', admin)).json()) as Summary;
  return people.find((person) => person.id === ctx.bob.userId);
};

const spend = (at: string, costUsd: number) =>
  recordUsage(ctx.owner, {
    ...ctx.bob,
    channel: 'fake',
    chatId: 'b',
    model: 'm',
    status: 'ok',
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd,
  }).then(() =>
    sql`update usage_ledger set created_at = ${at}::timestamptz
      where id = (select max(id) from usage_ledger where user_id = ${ctx.bob.userId})`.execute(
      ctx.owner,
    ),
  );

it('totals each person month on the local clock, across the time-zone edge', async () => {
  await sql`delete from usage_ledger where user_id = ${ctx.bob.userId}`.execute(ctx.owner);
  await spend('2026-11-30T21:30:00Z', 1.5); // 23:30 in Cairo: November
  await spend('2026-11-30T22:30:00Z', 2); // 00:30 on 1 December in Cairo
  const november = await call('GET', 'admin/budgets', admin);
  const body = (await november.json()) as Summary;
  expect(body).toMatchObject({ month: '2026-11', defaults: { limitUsd: '3', topupUsd: '5' } });
  expect(body.people.find((p) => p.id === ctx.bob.userId)).toMatchObject({
    spentUsd: '1.50000000',
    calls: 1,
  });
  expect(body.people.find((p) => p.id === ctx.alice.userId)?.role).toBe('admin');
  clock = Date.parse('2026-11-30T22:45:00Z');
  expect(await bob()).toMatchObject({ spentUsd: '2.00000000', calls: 1 });
});

it('shows own limit, task cap and approved top-ups of that month only', async () => {
  expect(await bob()).toMatchObject({ topupUsd: '0' });
  const topup = (month: string, amount: string) =>
    ctx.owner
      .insertInto('budget_topups')
      .values({
        user_id: ctx.bob.userId,
        workspace_id: ctx.bob.workspaceId,
        amount_usd: amount,
        month,
        status: 'approved',
        channel: 'f',
        chat_id: 'b',
        expires_at: new Date(clock),
      })
      .execute();
  await topup('2026-12', '5');
  await topup('2026-11', '7');
  expect(
    (await call('PUT', `admin/people/${ctx.bob.userId}/budget`, admin, { limitUsd: '12.5' }))
      .status,
  ).toBe(204);
  expect(
    (await call('PUT', `admin/people/${ctx.bob.userId}/task-cap`, admin, { cap: 4 })).status,
  ).toBe(204);
  const line = await bob();
  expect(line).toMatchObject({ limitUsd: '12.50000000', taskCap: 4, topupUsd: '5.00000000' });
  expect(line?.topupStepUsd).toBeUndefined();
  expect(
    (await call('PUT', `admin/people/${ctx.bob.userId}/task-cap`, admin, { cap: null })).status,
  ).toBe(204);
  expect((await bob())?.taskCap).toBeUndefined();
});

it('refuses a member everywhere, writes nothing, and audits each refusal', async () => {
  expect((await call('GET', 'admin/budgets', member)).status).toBe(403);
  expect((await call('GET', 'admin/budgets', '')).status).toBe(401);
  const mine = `admin/people/${ctx.bob.userId}`;
  expect((await call('PUT', `${mine}/budget`, member, { limitUsd: '999' })).status).toBe(403);
  expect((await call('PUT', `${mine}/task-cap`, member, { cap: 50 })).status).toBe(403);
  expect(await bob()).toMatchObject({ limitUsd: '12.50000000' });
  expect((await audits('admin.budget.set')).at(-1)).toBe('refused');
  expect((await audits('admin.task_cap.set')).at(-1)).toBe('refused');
  expect(await audits('admin.usage.summary')).toContain('refused');
});

it('rejects bad input with 400 and a stranger with 404', async () => {
  const mine = `admin/people/${ctx.bob.userId}`;
  expect((await call('PUT', `${mine}/budget`, admin, { limitUsd: '-1' })).status).toBe(400);
  expect((await call('PUT', `${mine}/budget`, admin, { limitUsd: 5 })).status).toBe(400);
  expect((await call('PUT', `${mine}/task-cap`, admin, { cap: 0 })).status).toBe(400);
  expect((await call('PUT', 'admin/people/nope/budget', admin, { limitUsd: '1' })).status).toBe(
    400,
  );
  const gone = '99999999-9999-4999-8999-999999999999';
  expect((await call('PUT', `admin/people/${gone}/budget`, admin, { limitUsd: '1' })).status).toBe(
    404,
  );
  expect((await call('PUT', `admin/people/${gone}/task-cap`, admin, { cap: 3 })).status).toBe(404);
});
