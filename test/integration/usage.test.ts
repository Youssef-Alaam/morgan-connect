import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
} from '@earendil-works/pi-ai';
import { sql } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { FAILURE_REPLY, STOPPED_REPLY, createReplier } from '../../src/core/index.js';
import { createDb, migrateToLatest, type Db, type Owner, type Turn } from '../../src/data/index.js';
import { createLogger } from '../../src/ops/index.js';
import {
  EngineError,
  createPiEngine,
  type Engine,
  type EngineCallUsage,
  type EngineSession,
} from '../../src/policy/index.js';
import { FakeChannel } from '../helpers/fake-channel.js';
import { linkChats } from '../helpers/link-chats.js';
import { startPostgres, type TestPostgres } from '../helpers/postgres.js';

let postgres: TestPostgres;
let db: Db;
let who: Owner;
let counter = 0;

beforeAll(async () => {
  postgres = await startPostgres();
  db = createDb(postgres.url);
  await migrateToLatest(db);
  who = await linkChats(db, ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7']);
}, 180_000);

afterAll(async () => {
  await db.destroy();
  await postgres.stop();
});

/** What one scripted prompt does: report its model calls, then answer, fail, or wait for an abort. */
interface Outcome {
  calls: EngineCallUsage[];
  end: 'text' | 'transient' | 'failed' | 'hang';
  /** Called when a hanging prompt starts waiting, so a test aborts only once the abort can land. */
  waiting?: () => void;
}

const call = (
  inputTokens: number,
  outputTokens: number,
  costUsd: number,
  { status = 'ok', cache = [0, 0] }: { status?: EngineCallUsage['status']; cache?: number[] } = {},
): EngineCallUsage => ({
  inputTokens,
  outputTokens,
  cacheReadTokens: cache[0] ?? 0,
  cacheWriteTokens: cache[1] ?? 0,
  costUsd,
  status,
});

const billedEngine = (outcomes: Outcome[]): Engine => ({
  open: ({ onUsage }): EngineSession => {
    const outcome = outcomes.shift();
    if (outcome === undefined) throw new Error('no outcome left');
    const abort = new AbortController();
    return {
      transcript: () => [
        { role: 'user', text: 'hello' },
        { role: 'assistant', text: 'hi' },
      ],
      prompt: async () => {
        if (outcome.end === 'hang') {
          outcome.waiting?.();
          // An abort that landed before this prompt began still counts (the time limit can fire first).
          await new Promise<void>((resolve) => {
            if (abort.signal.aborted) resolve();
            else
              abort.signal.addEventListener('abort', () => {
                resolve();
              });
          });
          outcome.calls.forEach((c) => onUsage?.({ ...c, status: 'aborted' }));
          throw new EngineError('aborted', 'aborted');
        }
        outcome.calls.forEach((c) => onUsage?.(c));
        if (outcome.end === 'text') return 'hi';
        throw new EngineError(outcome.end, 'scripted');
      },
      steer: () => undefined,
      abort: () => {
        abort.abort();
      },
      usage: () => ({ inputTokens: 0, outputTokens: 0, costUsd: 0 }),
    };
  },
});

const turn = (chatId: string, text: string): Turn => ({
  id: `u${String((counter += 1))}`,
  channel: 'fake',
  chatId,
  text,
  status: 'sending',
  ...who,
});
const replierWith = (engine: Engine, turnTimeoutMs = 5000) =>
  createReplier({
    db,
    engine,
    logger: createLogger('silent'),
    model: 'claude-sonnet-5-5',
    timezone: 'UTC',
    retryDelayMs: 0,
    typingIntervalMs: 5,
    turnTimeoutMs,
  });
const ledger = (chatId: string) =>
  db
    .selectFrom('usage_ledger')
    .select([
      'model',
      'status',
      'input_tokens',
      'output_tokens',
      'cache_read_tokens',
      'cache_write_tokens',
      'cost_usd',
    ])
    .where('chat_id', '=', chatId)
    .orderBy('id')
    .execute();

it('writes one row per model call, not per prompt (a tool step then an answer is two rows)', async () => {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall('nothing', {}), { stopReason: 'toolUse' }),
    fauxAssistantMessage(fauxText('done')),
  ]);
  const engine = createPiEngine({ models, model: faux.getModel(), apiKey: 'k' });
  expect(await replierWith(engine)(turn('L1', 'hello'), new FakeChannel())).toBe('done');
  const rows = await ledger('L1');
  expect(rows).toHaveLength(2);
  expect(rows.map((r) => r.status)).toEqual(['ok', 'ok']);
  expect(rows.every((r) => Number(r.input_tokens) > 0)).toBe(true);
});

it('stores tokens, cache tokens and cost exactly, with the model id', async () => {
  const engine = billedEngine([
    { calls: [call(100, 20, 0.00123456789, { cache: [300, 40] })], end: 'text' },
  ]);
  await replierWith(engine)(turn('L2', 'hello'), new FakeChannel());
  expect(await ledger('L2')).toEqual([
    {
      model: 'claude-sonnet-5-5',
      status: 'ok',
      input_tokens: '100',
      output_tokens: '20',
      cache_read_tokens: '300',
      cache_write_tokens: '40',
      cost_usd: '0.00123457',
    },
  ]);
});

it('records what a failed call was billed, and each retry as its own row', async () => {
  const engine = billedEngine([
    { calls: [call(50, 0, 0.0001, { status: 'failed' })], end: 'transient' },
    { calls: [call(70, 5, 0.0002, { status: 'failed' })], end: 'failed' },
  ]);
  expect(await replierWith(engine)(turn('L3', 'hello'), new FakeChannel())).toBe(FAILURE_REPLY);
  const rows = await ledger('L3');
  expect(rows.map((r) => [r.status, r.input_tokens, r.output_tokens, r.cost_usd])).toEqual([
    ['failed', '50', '0', '0.00010000'],
    ['failed', '70', '5', '0.00020000'],
  ]);
});

it('writes no row for a call that never reached the provider', async () => {
  const engine = billedEngine([{ calls: [call(0, 0, 0, { status: 'failed' })], end: 'failed' }]);
  await replierWith(engine)(turn('L4', 'hello'), new FakeChannel());
  expect(await ledger('L4')).toEqual([]);
});

it('tells an owner /stop (aborted) from the time limit (timeout)', async () => {
  const stopped = new AbortController();
  let waiting: () => void = () => undefined;
  const entered = new Promise<void>((resolve) => {
    waiting = resolve;
  });
  const hang: Outcome = { calls: [call(10, 0, 0.00001)], end: 'hang', waiting };
  const owner = replierWith(billedEngine([hang]))(
    turn('L5', 'hello'),
    new FakeChannel(),
    stopped.signal,
  );
  await entered;
  stopped.abort();
  expect(await owner).toBe(STOPPED_REPLY);
  const slow = replierWith(billedEngine([{ calls: [call(10, 0, 0.00001)], end: 'hang' }]), 50);
  expect(await slow(turn('L6', 'hello'), new FakeChannel())).toBe(FAILURE_REPLY);
  expect((await ledger('L5')).map((r) => r.status)).toEqual(['aborted']);
  expect((await ledger('L6')).map((r) => r.status)).toEqual(['timeout']);
});

it('still answers when the ledger cannot be written', async () => {
  await sql`alter table usage_ledger rename to usage_ledger_off`.execute(db);
  try {
    const engine = billedEngine([{ calls: [call(1, 1, 0.1)], end: 'text' }]);
    expect(await replierWith(engine)(turn('L7', 'hello'), new FakeChannel())).toBe('hi');
  } finally {
    await sql`alter table usage_ledger_off rename to usage_ledger`.execute(db);
  }
});

it('files the turn under the user stored on it, even when the chat is unlinked mid-turn', async () => {
  await linkChats(db, ['L8']);
  const inner = billedEngine([{ calls: [call(5, 1, 0.01)], end: 'text' }]);
  const engine: Engine = {
    open: (options) => {
      const session = inner.open(options);
      return {
        ...session,
        prompt: async (text, ...rest) => {
          await sql`delete from devices where chat_id = 'L8'`.execute(db);
          return session.prompt(text, ...rest);
        },
      };
    },
  };
  expect(await replierWith(engine)(turn('L8', 'hello'), new FakeChannel())).toBe('hi');
  const owned = await sql`select user_id, workspace_id from usage_ledger where chat_id = 'L8'
    union all select user_id, workspace_id from chat_messages where chat_id = 'L8'`.execute(db);
  expect(owned.rows).toHaveLength(3);
  for (const row of owned.rows) {
    expect(row).toEqual({ user_id: who.userId, workspace_id: who.workspaceId });
  }
});
