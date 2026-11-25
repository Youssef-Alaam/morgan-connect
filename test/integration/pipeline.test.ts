import { sql } from 'kysely';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { type PipelineDeps, ingest, processTurn, startWorker } from '../../src/core/index.js';
import {
  createDb,
  createTurnQueue,
  getTurn,
  migrateToLatest,
  type Db,
} from '../../src/data/index.js';
import type { TurnQueue } from '../../src/data/index.js';
import { createLogger } from '../../src/ops/index.js';
import { FakeChannel } from '../helpers/fake-channel.js';
import { startPostgres, type TestPostgres } from '../helpers/postgres.js';

let postgres: TestPostgres;
let db: Db;
let queue: TurnQueue;
const logger = createLogger('silent');

beforeAll(async () => {
  postgres = await startPostgres();
  db = createDb(postgres.url);
  await migrateToLatest(db);
  queue = createTurnQueue(postgres.url, () => undefined);
  await queue.start();
}, 180_000);

afterAll(async () => {
  await queue.stop();
  await db.destroy();
  await postgres.stop();
});

const deps = (channel: FakeChannel): PipelineDeps => ({
  db,
  queue,
  senders: [channel],
  logger,
  retryDelayMs: 0,
});
const message = (messageId: string, text = 'hello') => ({
  channel: 'fake',
  chatId: '42',
  messageId,
  text,
});
/** A turn row with no queued job, so only the test's own processTurn call touches it. */
const seed = async (messageId: string, channel = 'fake'): Promise<string> =>
  (
    await sql<{ id: string }>`insert into turns (idempotency_key, channel, chat_id, text)
      values (${`${channel}:42:${messageId}`}, ${channel}, '42', 'x') returning id`.execute(db)
  ).rows[0]?.id ?? '';
const turnRow = async (messageId: string) =>
  (
    await sql<{ id: string; status: string; reply_text: string | null; error: string | null }>`
      select id, status, reply_text, error from turns where idempotency_key = ${`fake:42:${messageId}`}`.execute(
      db,
    )
  ).rows[0];

it('echoes a message through turn row, queue, worker and channel, exactly once', async () => {
  const channel = new FakeChannel();
  await startWorker(deps(channel));
  await ingest(deps(channel), message('1', 'ping'));
  await ingest(deps(channel), message('1', 'ping'));
  await vi.waitFor(
    async () => {
      expect((await turnRow('1'))?.status).toBe('done');
    },
    {
      timeout: 30_000,
    },
  );
  expect(channel.attempts).toEqual([{ chatId: '42', text: 'ping' }]);
  expect((await turnRow('1'))?.reply_text).toBe('ping');
});

it('after a worker dies mid-send, the redelivered job does not send the reply again', async () => {
  const dying = new FakeChannel();
  dying.hang = true;
  const id = await seed('2');
  void processTurn(deps(dying), id);
  await vi.waitFor(() => {
    expect(dying.attempts).toHaveLength(1);
  });
  expect((await getTurn(db, id))?.status).toBe('sending');

  const restarted = new FakeChannel();
  await processTurn(deps(restarted), id);
  expect(restarted.attempts).toHaveLength(0);
  expect(await turnRow('2')).toMatchObject({ status: 'failed', error: 'interrupted' });
});

it('retries a failing send three times, then marks the turn failed', async () => {
  const channel = new FakeChannel();
  channel.failures = 99;
  const id = await seed('3');
  await processTurn(deps(channel), id);
  expect(channel.attempts).toHaveLength(4);
  expect(await turnRow('3')).toMatchObject({ status: 'failed', error: 'send_failed' });
});
