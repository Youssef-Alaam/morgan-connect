import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import {
  claimTurn,
  createDb,
  createTurnQueue,
  finishTurn,
  getTurn,
  insertTurn,
  migrateToLatest,
  type Db,
  type TurnQueue,
} from '../../src/data/index.js';
import { startPostgres, type TestPostgres } from '../helpers/postgres.js';

let postgres: TestPostgres;
let db: Db;
let queue: TurnQueue;

beforeAll(async () => {
  postgres = await startPostgres();
  db = createDb(postgres.url);
  await migrateToLatest(db);
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

it('stores one turn per idempotency key, with no user or workspace yet', async () => {
  const first = await insertTurn(db, newTurn('k1'));
  const again = await insertTurn(db, newTurn('k1'));
  expect(first).toMatchObject({ created: true, status: 'queued' });
  expect(again).toEqual({ id: first.id, status: 'queued', created: false });
  const row = await db
    .selectFrom('turns')
    .selectAll()
    .where('id', '=', first.id)
    .executeTakeFirst();
  expect(row).toMatchObject({ user_id: null, workspace_id: null });
});

it('lets exactly one caller claim a turn, and records how it finished', async () => {
  const { id } = await insertTurn(db, newTurn('k2'));
  expect(await claimTurn(db, id)).toMatchObject({ id, text: 'hi', status: 'sending' });
  expect(await claimTurn(db, id)).toBeUndefined();
  await finishTurn(db, id, { status: 'done', replyText: 'hi' });
  expect((await getTurn(db, id))?.status).toBe('done');
});

it('delivers a queued turn id to the worker', async () => {
  const seen: string[] = [];
  await queue.work((turnId) => {
    seen.push(turnId);
    return Promise.resolve();
  });
  await queue.enqueue('turn-a');
  await vi.waitFor(
    () => {
      expect(seen).toEqual(['turn-a']);
    },
    { timeout: 30_000 },
  );
});
