import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  budgetOf,
  createDb,
  migrateToLatest,
  recordUsage,
  setBudget,
  type Db,
  type Owner,
} from '../../src/data/index.js';
import { checkBudget } from '../../src/policy/index.js';
import { linkChats } from '../helpers/link-chats.js';
import { startPostgres, type TestPostgres } from '../helpers/postgres.js';

let postgres: TestPostgres;
let db: Db;
let admin: Owner;
let who: Owner;

beforeAll(async () => {
  postgres = await startPostgres();
  db = createDb(postgres.url);
  await migrateToLatest(db);
  admin = await linkChats(db, ['B0']);
  const member = await db
    .insertInto('users')
    .values({ role: 'member', workspace_id: admin.workspaceId })
    .returning('id')
    .executeTakeFirstOrThrow();
  who = { userId: member.id, workspaceId: admin.workspaceId };
}, 180_000);
afterAll(async () => {
  await db.destroy();
  await postgres.stop();
});

const spend = (owner: Owner, costUsd: number) =>
  recordUsage(db, {
    ...owner,
    channel: 'fake',
    chatId: 'B1',
    model: 'm',
    status: 'ok',
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd,
  });

const check = (extra: Partial<Parameters<typeof checkBudget>[2]> = {}, owner = who) =>
  checkBudget(db, owner, { keySource: 'admin', timezone: 'UTC', now: new Date(), ...extra });

it('lets a person with no limit and no install default spend freely', async () => {
  await spend(who, 50);
  expect(await check()).toEqual({ allowed: true });
});

it('applies the install default to a person with no limit of their own', async () => {
  expect(await check({ defaultLimitUsd: '10' })).toMatchObject({ allowed: false, limitUsd: '10' });
  expect(await check({ defaultLimitUsd: '100' })).toEqual({ allowed: true });
});

it("prefers the person's own limit, and refuses once spend reaches it exactly", async () => {
  expect(await setBudget(db, admin, who.userId, '50')).toBe(true);
  expect(await budgetOf(db, who)).toBe('50.00000000');
  expect(await check({ defaultLimitUsd: '1000' })).toEqual({
    allowed: false,
    limitUsd: '50.00000000',
    spentUsd: '50.00000000',
  });
  await setBudget(db, admin, who.userId, '50.00000001');
  expect(await check()).toEqual({ allowed: true });
  await setBudget(db, admin, who.userId, '0');
  expect(await check()).toMatchObject({ allowed: false });
});

it("never limits a call paid by the person's own key or subscription (D46)", async () => {
  await setBudget(db, admin, who.userId, '0');
  expect(await check({ keySource: 'own' })).toEqual({ allowed: true });
});

it('never limits the admin, whatever the default or their own row says', async () => {
  await spend(admin, 50);
  expect(await check({ defaultLimitUsd: '0' }, admin)).toEqual({ allowed: true });
});

it('counts the month in the given time zone, so next month starts clean', async () => {
  await setBudget(db, admin, who.userId, '50');
  expect(await check({ now: new Date(Date.now() + 40 * 86_400_000) })).toEqual({ allowed: true });
  // Spend at 23:50 UTC on 28 Feb is last month in UTC but still the same month as `now` in Los Angeles.
  const now = new Date('2031-03-01T00:30:00Z');
  await db
    .updateTable('usage_ledger')
    .set({ created_at: new Date('2031-02-28T23:50:00Z') })
    .execute();
  expect(await check({ now })).toEqual({ allowed: true });
  expect(await check({ now, timezone: 'America/Los_Angeles' })).toMatchObject({ allowed: false });
});

it('refuses a limit that is not a plain amount', async () => {
  await expect(setBudget(db, admin, who.userId, '-1')).rejects.toThrow(/plain USD/);
  await expect(setBudget(db, admin, who.userId, '1e3')).rejects.toThrow(/plain USD/);
});

it('lets only an admin set a limit, and audits every attempt', async () => {
  const before = await budgetOf(db, who);
  expect(await setBudget(db, who, who.userId, '999')).toBe(false);
  expect(await setBudget(db, who, admin.userId, '999')).toBe(false);
  expect(await budgetOf(db, who)).toBe(before);
  expect(await budgetOf(db, admin)).toBeUndefined();
  const stranger = '00000000-0000-0000-0000-0000000000aa';
  expect(await setBudget(db, admin, stranger, '1')).toBe(false);
  const rows = await db
    .selectFrom('audit_log')
    .select(['user_id', 'subject_user_id', 'outcome'])
    .where('tool', '=', 'admin.budget.set')
    .orderBy('id', 'desc')
    .limit(3)
    .execute();
  expect(rows).toEqual([
    { user_id: admin.userId, subject_user_id: stranger, outcome: 'refused' },
    { user_id: who.userId, subject_user_id: admin.userId, outcome: 'refused' },
    { user_id: who.userId, subject_user_id: who.userId, outcome: 'refused' },
  ]);
});
