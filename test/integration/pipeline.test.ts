import { sql } from 'kysely';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import {
  type PipelineDeps,
  ingest,
  processTurn,
  requeueStuckTurns,
  startWorker,
} from '../../src/core/index.js';
import {
  createDb,
  createTurnQueue,
  getTurn,
  migrateToLatest,
  type Db,
  type TurnQueue,
} from '../../src/data/index.js';
import { createIdentity } from '../../src/identity/index.js';
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
  await sql`insert into users (id) values ('00000000-0000-0000-0000-000000000042')`.execute(db);
  await sql`insert into devices (user_id, channel, chat_id) values ('00000000-0000-0000-0000-000000000042', 'fake', '42')`.execute(
    db,
  );
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
  identity: createIdentity(db),
});
const message = (messageId: string, text = 'hello') => ({
  channel: 'fake',
  chatId: '42',
  messageId,
  text,
});
/** A turn row with no job. */
const seed = async (messageId: string, channel = 'fake'): Promise<string> =>
  (
    await sql<{
      id: string;
    }>`insert into turns (idempotency_key, channel, chat_id, text, user_id, workspace_id)
      select ${`${channel}:42:${messageId}`}, ${channel}, '42', 'x', id, workspace_id
      from users where id = '00000000-0000-0000-0000-000000000042' returning id`.execute(db)
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
  const worker = createTurnQueue(postgres.url, () => undefined);
  await worker.start();
  await startWorker({ ...deps(channel), queue: worker });
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
  await worker.stop();
});

it('after a worker is killed mid-send, the redelivered job does not send the reply again', async () => {
  const tuning = { expireInSeconds: 1, superviseIntervalSeconds: 1 };
  const dying = new FakeChannel();
  dying.hang = true;
  const first = createTurnQueue(postgres.url, () => undefined, tuning);
  await first.start();
  await startWorker({ ...deps(dying), queue: first });
  await ingest(deps(dying), message('2'));
  await vi.waitFor(
    () => {
      expect(dying.attempts).toHaveLength(1);
    },
    { timeout: 30_000 },
  );
  await first.stop({ graceful: false });

  const restarted = new FakeChannel();
  const second = createTurnQueue(postgres.url, () => undefined, tuning);
  await second.start();
  await startWorker({ ...deps(restarted), queue: second });
  await vi.waitFor(
    async () => {
      expect((await turnRow('2'))?.status).toBe('failed');
    },
    { timeout: 60_000 },
  );
  expect(restarted.attempts).toHaveLength(0);
  expect(dying.attempts).toHaveLength(1);
  expect((await turnRow('2'))?.error).toBe('interrupted');
  await second.stop();
});

it('re-queues a turn that has no job', async () => {
  const id = await seed('5');
  expect(await requeueStuckTurns(deps(new FakeChannel()))).toBeGreaterThanOrEqual(1);
  expect((await getTurn(db, id))?.status).toBe('queued');
});
it('retries a failing send three times, then marks the turn failed', async () => {
  const channel = new FakeChannel();
  channel.failures = 99;
  const id = await seed('3');
  await processTurn(deps(channel), id);
  expect(channel.attempts).toHaveLength(4);
  expect(await turnRow('3')).toMatchObject({ status: 'failed', error: 'send_failed' });
});

it('logs and rethrows an invalid payload without storing it', async () => {
  await expect(
    ingest(deps(new FakeChannel()), { channel: 'fake', text: 'secret' }),
  ).rejects.toThrow(/Invalid message fields/);
});
