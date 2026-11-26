import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeApproval,
  closeOrphanedApprovals,
  consumeApproval,
  createApproval,
  createDb,
  decideApproval,
  migrateToLatest,
  type Db,
  type Owner,
} from '../../src/data/index.js';
import { linkChats } from '../helpers/link-chats.js';
import { startPostgres, type TestPostgres } from '../helpers/postgres.js';

const OWNER_CHAT = { channel: 'fake', chatId: 'owner-chat' };
const NOW = new Date('2026-11-26T10:00:00Z');
const LATER = new Date(NOW.getTime() + 60_000);
let postgres: TestPostgres;
let db: Db;
let owner: Owner;

beforeAll(async () => {
  postgres = await startPostgres();
  db = createDb(postgres.url);
  await migrateToLatest(db);
  owner = await linkChats(db, ['owner-chat']);
  // A second person with their own chat: linked, but not the owner of these questions.
  const member = await db
    .insertInto('users')
    .values({ role: 'member' })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('devices')
    .values({ user_id: member.id, channel: 'fake', chat_id: 'member-chat' })
    .execute();
}, 180_000);

afterAll(async () => {
  await db.destroy();
  await postgres.stop();
});

beforeEach(async () => {
  await sql`truncate approvals`.execute(db);
});

const open = (hash = 'h1', expiresAt = LATER): Promise<string> =>
  createApproval(db, { owner, ...OWNER_CHAT, tool: 'demo.gated', argsSha256: hash, expiresAt });
const statusOf = async (id: string): Promise<string | undefined> =>
  (await db.selectFrom('approvals').select('status').where('id', '=', id).executeTakeFirst())
    ?.status;
const answer = (id: string, chat = OWNER_CHAT, decision: 'approved' | 'denied' = 'approved') =>
  decideApproval(db, { id, decision, ...chat, now: NOW });

it('stores the question under the owner, pending, with a hash and no arguments', async () => {
  const id = await open('abc');
  const row = await db.selectFrom('approvals').selectAll().where('id', '=', id).executeTakeFirst();
  expect(row).toMatchObject({
    user_id: owner.userId,
    workspace_id: owner.workspaceId,
    status: 'pending',
    args_sha256: 'abc',
    tool: 'demo.gated',
  });
});

it('takes only the owner linked chat as an answer, and only once', async () => {
  const id = await open();
  for (const chat of [
    { channel: 'fake', chatId: 'member-chat' },
    { channel: 'fake', chatId: 'nobody' },
    { channel: 'other', chatId: 'owner-chat' },
  ]) {
    expect(await answer(id, chat)).toBe(false);
  }
  expect(await statusOf(id)).toBe('pending');
  expect(await answer(id)).toBe(true);
  expect(await answer(id)).toBe(false);
  expect(await answer(id, OWNER_CHAT, 'denied')).toBe(false);
  expect(await statusOf(id)).toBe('approved');
});

it('takes no answer once the time is up', async () => {
  const id = await open('h1', NOW);
  expect(await answer(id)).toBe(false);
  expect(await statusOf(id)).toBe('pending');
});

it('is spent on the exact call, once, and not before approval or after expiry', async () => {
  const id = await open('h1');
  const use = (hash: string, now = NOW) => consumeApproval(db, { id, argsSha256: hash, now });
  expect(await use('h1')).toBe(false); // not approved yet
  await answer(id);
  expect(await use('other')).toBe(false); // other arguments, other hash
  expect(await use('h1', LATER)).toBe(false); // too late
  expect(await use('h1')).toBe(true);
  expect(await use('h1')).toBe(false); // single use
  expect(await statusOf(id)).toBe('used');
});

it('closes a question that is still open, but never a used or denied one', async () => {
  const waiting = await open();
  const denied = await open();
  await answer(denied, OWNER_CHAT, 'denied');
  expect(await closeApproval(db, waiting, 'expired')).toBe(true);
  expect(await closeApproval(db, waiting, 'cancelled')).toBe(false);
  expect(await closeApproval(db, denied, 'expired')).toBe(false);
  expect(await statusOf(waiting)).toBe('expired');
  expect(await statusOf(denied)).toBe('denied');
});

it('lets an Approve that beat the timer stand, but a cancel still ends it', async () => {
  const id = await open();
  await answer(id);
  expect(await closeApproval(db, id, 'expired')).toBe(false);
  expect(await statusOf(id)).toBe('approved');
  expect(await closeApproval(db, id, 'cancelled')).toBe(true);
});

it('closes every open question at startup, approved but unused ones too', async () => {
  const pending = await open();
  const approved = await open();
  await answer(approved);
  const used = await open();
  await answer(used);
  await consumeApproval(db, { id: used, argsSha256: 'h1', now: NOW });
  expect(await closeOrphanedApprovals(db)).toBe(2);
  expect([await statusOf(pending), await statusOf(approved), await statusOf(used)]).toEqual([
    'expired',
    'expired',
    'used',
  ]);
  expect(await closeOrphanedApprovals(db)).toBe(0);
});

it('refuses a row whose user belongs to another workspace', async () => {
  await sql`insert into workspaces (id, name) values ('00000000-0000-0000-0000-0000000000f2', 'Other')`.execute(
    db,
  );
  await expect(
    createApproval(db, {
      owner: { userId: owner.userId, workspaceId: '00000000-0000-0000-0000-0000000000f2' },
      ...OWNER_CHAT,
      tool: 't',
      argsSha256: 'h',
      expiresAt: LATER,
    }),
  ).rejects.toThrow();
});
