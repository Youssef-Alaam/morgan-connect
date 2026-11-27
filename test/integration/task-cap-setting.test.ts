import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  DEFAULT_TASK_CAP,
  createDb,
  migrateToLatest,
  setTaskCap,
  taskCapOf,
  type Db,
  type Owner,
} from '../../src/data/index.js';
import { linkChats } from '../helpers/link-chats.js';
import { startPostgres, type TestPostgres } from '../helpers/postgres.js';

let postgres: TestPostgres;
let db: Db;
let admin: Owner;
let member: Owner;

beforeAll(async () => {
  postgres = await startPostgres();
  db = createDb(postgres.url);
  await migrateToLatest(db);
  admin = await linkChats(db, ['A1']);
  const user = await db
    .insertInto('users')
    .values({ role: 'member', workspace_id: admin.workspaceId })
    .returning('id')
    .executeTakeFirstOrThrow();
  member = { userId: user.id, workspaceId: admin.workspaceId };
}, 180_000);
afterAll(async () => {
  await db.destroy();
  await postgres.stop();
});

it('gives a person the default cap of 2 until the admin sets one', async () => {
  expect(DEFAULT_TASK_CAP).toBe(2);
  expect(await taskCapOf(db, member)).toBe(2);
  expect(await setTaskCap(db, admin, member.userId, 5)).toBe(true);
  expect(await taskCapOf(db, member)).toBe(5);
  expect(await setTaskCap(db, admin, member.userId, null)).toBe(true);
  expect(await taskCapOf(db, member)).toBe(2);
});

it('lets only an admin set it, refuses a bad number, and audits every attempt', async () => {
  expect(await setTaskCap(db, member, member.userId, 50)).toBe(false);
  expect(await taskCapOf(db, member)).toBe(2);
  await expect(setTaskCap(db, admin, member.userId, 0)).rejects.toThrow(/at least 1/);
  await expect(setTaskCap(db, admin, member.userId, 1.5)).rejects.toThrow(/at least 1/);
  const audit = await db
    .selectFrom('audit_log')
    .select('outcome')
    .where('tool', '=', 'admin.task_cap.set')
    .orderBy('created_at')
    .execute();
  expect(audit.map((row) => row.outcome)).toEqual(['ok', 'ok', 'refused']);
});

it('refuses a member outside the admin workspace', async () => {
  const stranger = await db
    .insertInto('workspaces')
    .values({ name: 'other' })
    .returning('id')
    .executeTakeFirstOrThrow();
  const outsider = await db
    .insertInto('users')
    .values({ role: 'member', workspace_id: stranger.id })
    .returning('id')
    .executeTakeFirstOrThrow();
  expect(await setTaskCap(db, admin, outsider.id, 9)).toBe(false);
  expect(await taskCapOf(db, { userId: outsider.id, workspaceId: stranger.id })).toBe(2);
});
