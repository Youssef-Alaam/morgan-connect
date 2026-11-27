import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import {
  claimTurn,
  createDb,
  createTurnQueue,
  finishTurn,
  getTurn,
  insertTurn,
  listQueuedTurnIds,
  migrateToLatest,
  type Db,
  type Owner,
  type TurnQueue,
} from '../../src/data/index.js';
import { linkChats } from '../helpers/link-chats.js';
import { startPostgres, type TestPostgres } from '../helpers/postgres.js';

let postgres: TestPostgres;
let db: Db;
let queue: TurnQueue;
let who: Owner;

beforeAll(async () => {
  postgres = await startPostgres();
  db = createDb(postgres.url);
  await migrateToLatest(db);
  who = await linkChats(db, ['1']);
  queue = createTurnQueue(postgres.url, () => undefined);
  await queue.start();
});

afterAll(async () => {
  await queue.stop();
  await db.destroy();
  await postgres.stop();
});

const newTurn = (key: string) => ({
  idempotencyKey: key,
  channel: 'fake',
  chatId: '1',
  text: 'hi',
});

it('stores one turn per idempotency key, owned by the chat user and workspace', async () => {
  const first = await insertTurn(db, newTurn('k1'));
  const again = await insertTurn(db, newTurn('k1'));
  expect(first).toMatchObject({ created: true, status: 'queued' });
  expect(again).toEqual({ id: first.id, status: 'queued', created: false });
  const row = await db
    .selectFrom('turns')
    .selectAll()
    .where('id', '=', first.id)
    .executeTakeFirst();
  const owner = await db
    .selectFrom('devices')
    .innerJoin('users', 'users.id', 'devices.user_id')
    .select(['users.id as user_id', 'users.workspace_id'])
    .where('devices.chat_id', '=', '1')
    .executeTakeFirstOrThrow();
  expect(row).toMatchObject(owner);
  await expect(insertTurn(db, { ...newTurn('k-stranger'), chatId: 'nobody' })).rejects.toThrow(
    'No linked user',
  );
});

it('lets exactly one caller claim a turn, and records how it finished', async () => {
  const { id } = await insertTurn(db, newTurn('k2'));
  expect(await claimTurn(db, who, id)).toMatchObject({ id, text: 'hi', status: 'sending' });
  expect(await claimTurn(db, who, id)).toBeUndefined();
  await finishTurn(db, who, id, { status: 'done', replyText: 'hi' });
  expect((await getTurn(db, who, id))?.status).toBe('done');
});

it('finishes only a turn that is sending, and lists turns still queued', async () => {
  const { id } = await insertTurn(db, newTurn('k3'));
  await finishTurn(db, who, id, { status: 'done', replyText: 'hi' });
  expect((await getTurn(db, who, id))?.status).toBe('queued');
  expect(await listQueuedTurnIds(db)).toContain(id);
  await claimTurn(db, who, id);
  expect(await listQueuedTurnIds(db)).not.toContain(id);
});

it('delivers a queued turn id to the worker, and again after a later answer', async () => {
  const seen: string[] = [];
  await queue.work((turnId) => {
    seen.push(turnId);
    return Promise.resolve(seen.length === 1 ? 'later' : undefined);
  });
  await queue.enqueue('turn-a');
  await vi.waitFor(
    () => {
      expect(seen).toEqual(['turn-a', 'turn-a']);
    },
    { timeout: 30_000 },
  );
});
