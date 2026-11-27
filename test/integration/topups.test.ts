import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  createDb,
  ensureAppRole,
  migrateToLatest,
  recordUsage,
  setBudget,
  type Db,
  type Owner,
} from '../../src/data/index.js';
import { createTopups, type Topups } from '../../src/policy/index.js';
import type { Logger } from '../../src/ops/index.js';
import { linkChats } from '../helpers/link-chats.js';
import { startPostgres, type TestPostgres } from '../helpers/postgres.js';

let postgres: TestPostgres;
let owner: Db;
let app: Db;
let admin: Owner;
let member: Owner;
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

/** What the admin was asked, in order. */
let asked: { chatId: string; text: string; approvalId: string }[];
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
    now: () => clock,
    logger: { warn: (...args: unknown[]) => warned.push(args) } as unknown as Logger,
  });

beforeEach(async () => {
  asked = [];
  failAsking = false;
  clock = start;
  await owner.deleteFrom('budget_topups').execute();
  await owner.deleteFrom('usage_ledger').execute();
  await setBudget(app, admin, member.userId, '1');
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
