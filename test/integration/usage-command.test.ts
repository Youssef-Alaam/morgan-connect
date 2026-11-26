import { sql } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createReplier } from '../../src/core/index.js';
import {
  createDb,
  migrateToLatest,
  recordUsage,
  usageSince,
  type Db,
} from '../../src/data/index.js';
import { createLogger } from '../../src/ops/index.js';
import type { Engine } from '../../src/policy/index.js';
import { FakeChannel } from '../helpers/fake-channel.js';
import { linkChats } from '../helpers/link-chats.js';
import { startPostgres, type TestPostgres } from '../helpers/postgres.js';

let postgres: TestPostgres;
let db: Db;

beforeAll(async () => {
  postgres = await startPostgres();
  db = createDb(postgres.url);
  await migrateToLatest(db);
  await linkChats(db, ['T', 'c']);
}, 180_000);

afterAll(async () => {
  await db.destroy();
  await postgres.stop();
});

/** A ledger row at an exact time. */
const put = async (iso: string, cost: number, input = 10, output = 1): Promise<void> => {
  await recordUsage(db, {
    channel: 'fake',
    chatId: 'T',
    model: 'm',
    status: 'ok',
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: cost,
  });
  await sql`update usage_ledger set created_at = ${new Date(iso)}::timestamptz where id = (select max(id) from usage_ledger)`.execute(
    db,
  );
};
const clear = async (): Promise<void> => {
  await sql`delete from usage_ledger`.execute(db);
};

it('splits days and months at local midnight, not UTC midnight', async () => {
  await clear();
  await put('2026-11-30T10:00:00Z', 1);
  await put('2026-11-30T20:00:00Z', 2, 20, 2);
  await put('2026-11-30T21:30:00Z', 4.25, 40, 4);
  const now = new Date('2026-11-30T22:30:00Z');
  const utc = await usageSince(db, now, 'UTC');
  expect(utc.today).toMatchObject({ calls: 3, costUsd: '7.25000000', inputTokens: 70 });
  expect(utc.month).toMatchObject({ calls: 3, costUsd: '7.25000000' });
  // Riyadh is UTC+3: it is 01:30 on 1 December there.
  const riyadh = await usageSince(db, now, 'Asia/Riyadh');
  expect(riyadh.today).toMatchObject({ calls: 1, costUsd: '4.25000000', inputTokens: 40 });
  expect(riyadh.month).toMatchObject({ calls: 1, costUsd: '4.25000000' });
  await clear();
  // 31 October 22:00 UTC is already 1 November in Riyadh, but still October in UTC.
  await put('2026-10-31T22:00:00Z', 8);
  const mid = new Date('2026-11-15T12:00:00Z');
  expect((await usageSince(db, mid, 'Asia/Riyadh')).month.calls).toBe(1);
  expect((await usageSince(db, mid, 'UTC')).month.calls).toBe(0);
});

it('keeps a 25 hour day (clock change) as one day and ignores other days and months', async () => {
  await clear();
  // New York ends daylight time on 1 November 2026: local midnight is 04:00Z, the next is 05:00Z.
  await put('2026-11-01T03:59:00Z', 1); // 31 October, 23:59 local
  await put('2026-11-01T04:00:00Z', 2); // first minute of the day
  await put('2026-11-02T04:30:00Z', 4); // 23:30 local, the extra hour
  await put('2026-11-02T05:00:00Z', 8); // 2 November, 00:00 local
  await put('2026-12-01T05:00:00Z', 16); // next month
  const now = new Date('2026-11-01T12:00:00Z');
  const ny = await usageSince(db, now, 'America/New_York');
  expect(ny.today).toMatchObject({ calls: 2, costUsd: '6.00000000' });
  expect(ny.month).toMatchObject({ calls: 3, costUsd: '14.00000000' });
});

it('/usage and /usage@BotName reply with the totals; empty is zero', async () => {
  await clear();
  const engine: Engine = {
    open: () => {
      throw new Error('no model call expected');
    },
  };
  const reply = createReplier({
    db,
    engine,
    logger: createLogger('silent'),
    model: 'm',
    timezone: 'Asia/Riyadh',
    retryDelayMs: 0,
    typingIntervalMs: 5,
    turnTimeoutMs: 5000,
  });
  const ask = (text: string) =>
    reply({ id: 'x', channel: 'fake', chatId: 'c', text, status: 'sending' }, new FakeChannel());
  expect(await ask('/usage')).toBe(
    [
      'Usage (Asia/Riyadh)',
      'Today: $0.0000, 0 calls, 0 tokens in, 0 out',
      'This month: $0.0000, 0 calls, 0 tokens in, 0 out',
    ].join('\n'),
  );
  await recordUsage(db, {
    channel: 'fake',
    chatId: 'c',
    model: 'm',
    status: 'ok',
    inputTokens: 1500,
    outputTokens: 250,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0.0123,
  });
  const text = await ask('/usage@MorganBot');
  expect(text).toContain('Today: $0.0123, 1 call, 1,500 tokens in, 250 out');
  expect(text).toContain('This month: $0.0123, 1 call, 1,500 tokens in, 250 out');
});
