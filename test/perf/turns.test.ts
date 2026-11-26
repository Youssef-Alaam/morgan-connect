import { afterAll, beforeAll, expect, it } from 'vitest';
import { createReplier, ingest, startWorker, type PipelineDeps } from '../../src/core/index.js';
import { createDb, createTurnQueue, migrateToLatest, type Db } from '../../src/data/index.js';
import { createIdentity } from '../../src/identity/index.js';
import { createLogger } from '../../src/ops/index.js';
import { FakeChannel } from '../helpers/fake-channel.js';
import { ScriptedEngine } from '../helpers/fake-engine.js';
import { linkChats } from '../helpers/link-chats.js';
import { startPostgres, type TestPostgres } from '../helpers/postgres.js';

/** STANDARDS section 8: the median overhead of a plain turn, and the time to the first sign of life. */
const MEDIAN_BUDGET_MS = 300;
const ACK_BUDGET_MS = 1000;
const TURNS = 50;

let postgres: TestPostgres;
let db: Db;

beforeAll(async () => {
  postgres = await startPostgres();
  db = createDb(postgres.url);
  await migrateToLatest(db);
  await linkChats(db, ['perf']);
}, 180_000);

afterAll(async () => {
  await db.destroy();
  await postgres.stop();
});

/** A fake channel that notes when each signal arrived. */
class TimedChannel extends FakeChannel {
  readonly typedAt: number[] = [];
  readonly sentAt: number[] = [];
  override typing(chatId: string): Promise<void> {
    this.typedAt.push(performance.now());
    return super.typing(chatId);
  }
  override async send(chatId: string, text: string): Promise<void> {
    this.sentAt.push(performance.now());
    await super.send(chatId, text);
  }
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const p95 = (values: number[]): number =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1] ?? 0;

it('adds at most 300 ms at the median to a plain turn, and shows life within 1 s', async () => {
  const engine = new ScriptedEngine(Array.from({ length: TURNS }, () => ({ text: 'pong' })));
  const logger = createLogger('silent');
  const channel = new TimedChannel();
  const queue = createTurnQueue(postgres.url, () => undefined);
  await queue.start();
  const deps: PipelineDeps = {
    db,
    queue,
    senders: [channel],
    logger,
    retryDelayMs: 0,
    identity: createIdentity(db),
    reply: createReplier({
      db,
      engine,
      logger,
      model: 'fake',
      timezone: 'UTC',
      retryDelayMs: 0,
      typingIntervalMs: 4000,
      turnTimeoutMs: 20_000,
    }),
  };
  await startWorker(deps);
  const overheads: number[] = [];
  const acks: number[] = [];
  for (let n = 0; n < TURNS; n += 1) {
    const start = performance.now();
    await ingest(deps, { channel: 'fake', chatId: 'perf', messageId: String(n), text: 'ping' });
    await expect.poll(() => channel.sentAt.length, { timeout: 20_000, interval: 5 }).toBe(n + 1);
    // The scripted model answers at once, so everything between send and reply is Morgan's.
    overheads.push((channel.sentAt[n] ?? 0) - start);
    acks.push((channel.typedAt[n] ?? Number.POSITIVE_INFINITY) - start);
  }
  await queue.stop();
  process.stdout.write(
    `perf: median ${median(overheads).toFixed(1)} ms, p95 ${p95(overheads).toFixed(1)} ms, worst ack ${Math.max(...acks).toFixed(1)} ms
`,
  );
  expect(median(overheads)).toBeLessThanOrEqual(MEDIAN_BUDGET_MS);
  expect(Math.max(...acks)).toBeLessThanOrEqual(ACK_BUDGET_MS);
}, 180_000);
