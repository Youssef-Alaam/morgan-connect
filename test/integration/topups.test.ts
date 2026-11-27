import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  createApproval,
  createDb,
  ensureAppRole,
  migrateToLatest,
  recordUsage,
  setBudget,
  topupTotal,
  type Db,
  type Owner,
} from '../../src/data/index.js';
import { checkBudget, createTopups, monthKey, type Topups } from '../../src/policy/index.js';
import type { Logger } from '../../src/ops/index.js';
import { linkChats } from '../helpers/link-chats.js';
import { startPostgres, type TestPostgres } from '../helpers/postgres.js';

let postgres: TestPostgres;
let owner: Db;
let app: Db;
let admin: Owner;
let member: Owner;
const adminChat = { channel: 'telegram', chatId: '1' };
const memberChat = { channel: 'telegram', chatId: '42' };

beforeAll(async () => {
  postgres = await startPostgres();
  owner = createDb(postgres.url);
  await migrateToLatest(owner);
  admin = await linkChats(owner, ['1'], 'telegram');
  const row = await owner
    .insertInto('users')
    .values({ role: 'member', workspace_id: admin.workspaceId })
    .returning('id')
    .executeTakeFirstOrThrow();
  member = { userId: row.id, workspaceId: admin.workspaceId };
  await owner
    .insertInto('devices')
    .values([
      { user_id: member.userId, channel: 'telegram', chat_id: '42' },
      { user_id: admin.userId, channel: 'telegram', chat_id: '2' },
    ])
    .execute();
  const url = new URL(postgres.url);
  url.username = 'morgan_app';
  url.password = 'app-pass-topups';
  await ensureAppRole(owner, url.toString());
  app = createDb(url.toString());
  topups = makeTopups();
}, 180_000);
afterAll(async () => {
  await app.destroy();
  await owner.destroy();
  await postgres.stop();
});

/** What the admin was asked and what the member was told, in order. */
let asked: { chatId: string; text: string; approvalId: string }[];
let told: { channel: string; chatId: string; text: string }[];
let failAsking = false;
const warned: unknown[][] = [];
let clock = new Date();

const start = new Date();
let topups: Topups;
const makeTopups = (): Topups =>
  createTopups({
    db: app,
    amountUsd: '5',
    keySource: 'admin',
    timezone: 'UTC',
    ttlMs: 60_000,
    adminChannel: 'telegram',
    askAdmin: (chatId, text, approvalId) => {
      if (failAsking) return Promise.reject(new Error('down'));
      asked.push({ chatId, text, approvalId });
      return Promise.resolve();
    },
    tell: (channel, chatId, text) => {
      told.push({ channel, chatId, text });
      return Promise.resolve();
    },
    now: () => clock,
    logger: { warn: (...args: unknown[]) => warned.push(args) } as unknown as Logger,
  });

beforeEach(async () => {
  asked = [];
  told = [];
  failAsking = false;
  clock = start;
  await owner.deleteFrom('budget_topups').execute();
  await owner.deleteFrom('usage_ledger').execute();
  await setBudget(app, admin, member.userId, '1');
  const last = await owner
    .selectFrom('audit_log')
    .select(sql<string>`coalesce(max(id), 0)::text`.as('id'))
    .executeTakeFirstOrThrow();
  auditFrom = Number(last.id);
});

const spend = (costUsd: number) =>
  recordUsage(app, {
    ...member,
    ...memberChat,
    model: 'm',
    status: 'ok',
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd,
  });
const limitNow = () =>
  checkBudget(app, member, { keySource: 'admin', timezone: 'UTC', now: new Date() });
const tap = (id: string, decision: 'approved' | 'denied', chat = adminChat) =>
  topups.decide({ id, decision, ...chat });
/** The audit log is append-only, so a test reads only what was written since it began. */
let auditFrom = 0;
const auditTools = () =>
  owner
    .selectFrom('audit_log')
    .select(['tool', 'outcome', 'user_id', 'subject_user_id'])
    .where('tool', 'like', '%topup%')
    .where('id', '>', String(auditFrom))
    .orderBy('id')
    .execute();

it('asks the admin with the person, the spend and the exact top-up, once per person', async () => {
  await spend(1);
  expect(await topups.ask(memberChat)).toBe('sent');
  expect(asked).toHaveLength(1);
  expect(asked[0]).toMatchObject({ chatId: '1' });
  expect(asked[0]?.text).toContain(`member ${member.userId.slice(0, 8)}`);
  expect(asked[0]?.text).toContain('$1.00 of $1.00');
  expect(asked[0]?.text).toContain('Add $5.00 for this month?');
  expect(await topups.ask(memberChat)).toBe('open');
  expect(asked).toHaveLength(1);
});

it('does not ask when the person is under their limit, or is not a known chat', async () => {
  expect(await topups.ask(memberChat)).toBe('unneeded');
  expect(await topups.ask({ channel: 'telegram', chatId: '999' })).toBe('unavailable');
  expect(asked).toEqual([]);
});

it('on Approve raises the limit by the amount, tells the member, and spends the approval once', async () => {
  await spend(1);
  await topups.ask(memberChat);
  const id = asked[0]?.approvalId ?? '';
  expect(await tap(id, 'approved')).toBe(true);
  expect(told).toEqual([
    { ...memberChat, text: "$5.00 was added to this month's limit. Carry on." },
  ]);
  const month = monthKey(clock, 'UTC');
  expect(await topupTotal(app, member, month)).toBe('5.00000000');
  expect(await limitNow()).toEqual({ allowed: true });
  await spend(5);
  expect(await limitNow()).toMatchObject({ allowed: false, limitUsd: '6.00000000' });
  const row = await owner
    .selectFrom('approvals')
    .select('status')
    .where('id', '=', id)
    .executeTakeFirst();
  expect(row?.status).toBe('used');
  expect(await tap(id, 'approved')).not.toBe(true);
  expect(await topupTotal(app, member, month)).toBe('5.00000000');
  expect(told).toHaveLength(1);
});

it('on Refuse tells the member in one sentence and leaves the limit alone', async () => {
  await spend(1);
  await topups.ask(memberChat);
  expect(await tap(asked[0]?.approvalId ?? '', 'denied')).toBe(true);
  expect(told).toEqual([{ ...memberChat, text: 'The admin said no to more this month.' }]);
  expect(await limitNow()).toMatchObject({ allowed: false, limitUsd: '1.00000000' });
  // The request is closed, so they may ask again.
  expect(await topups.ask(memberChat)).toBe('sent');
});

it('lets only the admin answer, from the chat the question went to', async () => {
  await spend(1);
  await topups.ask(memberChat);
  const id = asked[0]?.approvalId ?? '';
  expect(await tap(id, 'approved', memberChat)).toBeUndefined();
  expect(await tap(id, 'approved', { channel: 'telegram', chatId: '2' })).toBe(false);
  expect(await tap(id, 'approved', { channel: 'fake', chatId: '1' })).toBeUndefined();
  expect(told).toEqual([]);
  expect(await limitNow()).toMatchObject({ allowed: false });
  expect(await tap(id, 'approved')).toBe(true);
});

it('leaves a question that is not a top-up to the normal approvals', async () => {
  const id = await createApproval(app, {
    owner: admin,
    ...adminChat,
    tool: 'demo.gated',
    argsSha256: 'x',
    expiresAt: new Date(Date.now() + 60_000),
  });
  expect(await tap(id, 'approved')).toBeUndefined();
});

it('writes an audit row for the request and for the answer', async () => {
  await spend(1);
  await topups.ask(memberChat);
  await tap(asked[0]?.approvalId ?? '', 'approved');
  const subject = member.userId;
  expect(await auditTools()).toEqual([
    { tool: 'budget.topup.request', outcome: 'ok', user_id: subject, subject_user_id: subject },
    { tool: 'admin.budget.topup', outcome: 'ok', user_id: admin.userId, subject_user_id: subject },
  ]);
  await spend(5);
  await topups.ask(memberChat);
  await tap(asked[1]?.approvalId ?? '', 'denied');
  expect((await auditTools()).at(-1)).toMatchObject({
    tool: 'admin.budget.topup',
    outcome: 'denied',
  });
});

it('lets an unanswered request lapse, then a new one may be made', async () => {
  await spend(1);
  await topups.ask(memberChat);
  expect(await topups.ask(memberChat)).toBe('open');
  clock = new Date(clock.getTime() + 61_000);
  expect(await topups.ask(memberChat)).toBe('sent');
  const rows = await owner
    .selectFrom('budget_topups')
    .select('status')
    .orderBy('created_at')
    .execute();
  expect(rows.map((r) => r.status)).toEqual(['expired', 'open']);
  // The old question can no longer be answered.
  expect(await tap(asked[0]?.approvalId ?? '', 'approved')).toBeUndefined();
});

it('closes the request when the admin cannot be asked, so the member can try again', async () => {
  await spend(1);
  failAsking = true;
  expect(await topups.ask(memberChat)).toBe('unavailable');
  failAsking = false;
  expect(await topups.ask(memberChat)).toBe('sent');
});

it('says unavailable when there is no admin chat on the channel', async () => {
  await spend(1);
  await owner.deleteFrom('devices').where('chat_id', 'in', ['1', '2']).execute();
  try {
    expect(await topups.ask(memberChat)).toBe('unavailable');
  } finally {
    await owner
      .insertInto('devices')
      .values([
        { user_id: admin.userId, channel: 'telegram', chat_id: '1' },
        { user_id: admin.userId, channel: 'telegram', chat_id: '2' },
      ])
      .execute();
  }
});

/** Make the database refuse a top-up row reaching this status, as a failure in the middle would. */
async function failingTo(status: string): Promise<() => Promise<void>> {
  await sql`create function fail_topup() returns trigger language plpgsql as $$
    begin raise exception 'boom'; end $$`.execute(owner);
  await sql`create trigger fail_topup before update on budget_topups for each row
    when (new.status = ${sql.lit(status)}) execute function fail_topup()`.execute(owner);
  return async () => {
    await sql`drop trigger fail_topup on budget_topups`.execute(owner);
    await sql`drop function fail_topup()`.execute(owner);
  };
}

it('closes the request when the answer cannot be applied, so the member can ask again', async () => {
  await spend(1);
  await topups.ask(memberChat);
  const undo = await failingTo('approved');
  try {
    expect(await tap(asked[0]?.approvalId ?? '', 'approved')).toBe(false);
  } finally {
    await undo();
  }
  expect(told).toEqual([]);
  const rows = await owner.selectFrom('budget_topups').select('status').execute();
  expect(rows).toEqual([{ status: 'refused' }]);
  expect(await limitNow()).toMatchObject({ allowed: false, limitUsd: '1.00000000' });
  expect(await topups.ask(memberChat)).toBe('sent');
});

it('does not fail the member when the admin cannot be asked and the request cannot be closed', async () => {
  await spend(1);
  failAsking = true;
  const undo = await failingTo('cancelled');
  try {
    expect(await topups.ask(memberChat)).toBe('unavailable');
  } finally {
    await undo();
  }
  expect(warned).toHaveLength(1);
});
