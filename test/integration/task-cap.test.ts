import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { type PipelineDeps, ingest, processTurn, startWorker } from '../../src/core/index.js';
import {
  DEFAULT_TASK_CAP,
  claimTurn,
  createDb,
  createTurnQueue,
  finishTurn,
  getTurn,
  insertTurn,
  migrateToLatest,
  setTaskCap,
  taskCapOf,
  type Db,
  type Owner,
  type TurnQueue,
} from '../../src/data/index.js';
import { createIdentity } from '../../src/identity/index.js';
import { createLogger } from '../../src/ops/index.js';
import { FakeChannel } from '../helpers/fake-channel.js';
import { linkChats } from '../helpers/link-chats.js';
import { startPostgres, type TestPostgres } from '../helpers/postgres.js';

let postgres: TestPostgres;
let db: Db;
let admin: Owner;
let member: Owner;
let other: Owner;

async function addMember(chatId: string): Promise<Owner> {
  const user = await db
    .insertInto('users')
    .values({ role: 'member', workspace_id: admin.workspaceId })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('devices')
    .values({ user_id: user.id, channel: 'fake', chat_id: chatId })
    .execute();
  return { userId: user.id, workspaceId: admin.workspaceId };
}

beforeAll(async () => {
  postgres = await startPostgres();
  db = createDb(postgres.url);
  await migrateToLatest(db);
  admin = await linkChats(db, ['A1']);
  member = await addMember('M1');
  other = await addMember('O1');
}, 180_000);
afterEach(async () => {
  await sql`update turns set status = 'failed' where status in ('queued', 'sending')`.execute(db);
});
afterAll(async () => {
  await db.destroy();
  await postgres.stop();
});

let counter = 0;
/** Queue turns for a person's chat; ids come back in the order they were queued. */
async function queued(chatId: string, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    counter += 1;
    const turn = await insertTurn(db, {
      idempotencyKey: `cap-${String(counter)}`,
      channel: 'fake',
      chatId,
      text: 'work',
    });
    ids.push(turn.id);
  }
  return ids;
}
const status = async (owner: Owner, id: string) => (await getTurn(db, owner, id))?.status;
const close = (owner: Owner, id: string) =>
  finishTurn(db, owner, id, { status: 'done', replyText: 'ok' });

it('lets a person run two turns at once by default and holds the rest, in order', async () => {
  expect(await taskCapOf(db, member)).toBe(DEFAULT_TASK_CAP);
  const [a = '', b = '', c = '', d = ''] = await queued('M1', 4);
  expect(await claimTurn(db, member, c)).toBeUndefined();
  expect(await status(member, c)).toBe('queued');
  expect(await claimTurn(db, member, a)).toBeDefined();
  expect(await claimTurn(db, member, b)).toBeDefined();
  expect(await claimTurn(db, member, c)).toBeUndefined();
  await close(member, a);
  // The third starts once one finishes, and the fourth still waits behind it.
  expect(await claimTurn(db, member, d)).toBeUndefined();
  expect(await claimTurn(db, member, c)).toBeDefined();
  await close(member, b);
  await close(member, c);
  expect(await claimTurn(db, member, d)).toBeDefined();
  await close(member, d);
});

it('holds the cap across workers that share only the database', async () => {
  const workers = [createDb(postgres.url), createDb(postgres.url), createDb(postgres.url)];
  try {
    const ids = await queued('M1', 8);
    const claims = await Promise.all(
      ids.map((id, i) => claimTurn(workers[i % workers.length] ?? db, member, id)),
    );
    expect(claims.filter((turn) => turn !== undefined)).toHaveLength(DEFAULT_TASK_CAP);
    for (const id of ids) await finishTurn(db, member, id, { status: 'failed', error: 'test' });
  } finally {
    await Promise.all(workers.map((worker) => worker.destroy()));
  }
});

it("does not hold up another person's turns", async () => {
  const [a = '', b = '', c = ''] = await queued('M1', 3);
  await claimTurn(db, member, a);
  await claimTurn(db, member, b);
  const [theirs = ''] = await queued('O1', 1);
  expect(await claimTurn(db, other, theirs)).toBeDefined();
  expect(await claimTurn(db, member, c)).toBeUndefined();
  for (const id of [a, b, c]) await finishTurn(db, member, id, { status: 'failed', error: 'x' });
  await close(other, theirs);
});

it('follows the cap the admin sets, raised or lowered at any time', async () => {
  expect(await setTaskCap(db, admin, member.userId, 1)).toBe(true);
  expect(await taskCapOf(db, member)).toBe(1);
  const [a = '', b = ''] = await queued('M1', 2);
  expect(await claimTurn(db, member, a)).toBeDefined();
  expect(await claimTurn(db, member, b)).toBeUndefined();
  expect(await setTaskCap(db, admin, member.userId, 3)).toBe(true);
  expect(await claimTurn(db, member, b)).toBeDefined();
  await close(member, a);
  await close(member, b);
  await setTaskCap(db, admin, member.userId, null);
});

const deps = (channel: FakeChannel, queue: TurnQueue): PipelineDeps => ({
  db,
  queue,
  senders: [channel],
  logger: createLogger('silent'),
  retryDelayMs: 0,
  identity: createIdentity(db),
});

it('answers later for a turn held by the cap, and runs it when one finishes', async () => {
  const queue = createTurnQueue(postgres.url, () => undefined);
  await queue.start();
  try {
    const d = deps(new FakeChannel(), queue);
    const [a = '', b = '', held = ''] = await queued('M1', 3);
    await claimTurn(db, member, a);
    await claimTurn(db, member, b);
    expect(await processTurn(d, held)).toBe('later');
    expect(await status(member, held)).toBe('queued');
    await close(member, a);
    expect(await processTurn(d, held)).toBeUndefined();
    expect(await status(member, held)).toBe('done');
  } finally {
    await queue.stop();
  }
});

const row = async (key: string) =>
  db
    .selectFrom('turns')
    .select(['id', 'status', 'error'])
    .where('idempotency_key', '=', key)
    .executeTakeFirstOrThrow();

it('leaves a running turn alone when a duplicate job arrives, and fails a dead one', async () => {
  const queue = createTurnQueue(postgres.url, () => undefined);
  await queue.start();
  try {
    const d = deps(new FakeChannel(), queue);
    const [a = ''] = await queued('M1', 1);
    await claimTurn(db, member, a);
    expect(await processTurn(d, a)).toBeUndefined();
    expect(await status(member, a)).toBe('sending');
    await sql`update turns set claimed_at = now() - interval '10 minutes' where id = ${a}::uuid`.execute(
      db,
    );
    await processTurn(d, a);
    expect(await row(`cap-${String(counter)}`)).toMatchObject({
      status: 'failed',
      error: 'interrupted',
    });
  } finally {
    await queue.stop();
  }
});

it('sends one reply and keeps the cap when two jobs wait for the same turn', async () => {
  const channel = new FakeChannel();
  const queue = createTurnQueue(postgres.url, () => undefined);
  await queue.start();
  try {
    const d = deps(channel, queue);
    const [a = '', b = ''] = await queued('M1', 2);
    await claimTurn(db, member, a);
    await claimTurn(db, member, b);
    await ingest(d, { channel: 'fake', chatId: 'M1', messageId: 'dup', text: 'once' });
    const turn = await row('fake:M1:dup');
    await queue.enqueue(turn.id);
    await queue.enqueue(turn.id);
    const { rows } = await sql<{ n: string }>`select count(*) as n from pgboss.job
      where name = 'turn' and state = 'created' and data->>'turnId' = ${turn.id}`.execute(db);
    expect(Number(rows[0]?.n)).toBe(1);
    await close(member, a);
    await close(member, b);
    await startWorker(d);
    await vi.waitFor(
      async () => {
        expect((await row('fake:M1:dup')).status).toBe('done');
      },
      { timeout: 30_000 },
    );
    expect(channel.attempts.filter((sent) => sent.text === 'once')).toHaveLength(1);
  } finally {
    await queue.stop();
  }
});
