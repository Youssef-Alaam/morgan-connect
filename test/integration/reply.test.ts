import { sql } from 'kysely';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import {
  FAILURE_REPLY,
  NEW_REPLY,
  STOPPED_REPLY,
  createReplier,
  createTurnAborts,
  ingest,
  processTurn,
  type Replier,
} from '../../src/core/index.js';
import {
  appendHistory,
  createDb,
  getTurn,
  insertTurn,
  loadHistory,
  migrateToLatest,
  type Db,
  type Turn,
} from '../../src/data/index.js';
import { createIdentity } from '../../src/identity/index.js';
import { createLogger } from '../../src/ops/index.js';
import { FakeChannel } from '../helpers/fake-channel.js';
import { ScriptedEngine, type Step } from '../helpers/fake-engine.js';
import { startPostgres, type TestPostgres } from '../helpers/postgres.js';

let postgres: TestPostgres;
let db: Db;
let counter = 0;

beforeAll(async () => {
  postgres = await startPostgres();
  db = createDb(postgres.url);
  await migrateToLatest(db);
  await sql`insert into users (id) values ('00000000-0000-0000-0000-000000000008')`.execute(db);
  for (const chat of ['c8', 'c9']) {
    await sql`insert into devices (user_id, channel, chat_id) values ('00000000-0000-0000-0000-000000000008', 'fake', ${chat})`.execute(
      db,
    );
  }
}, 180_000);

afterAll(async () => {
  await db.destroy();
  await postgres.stop();
});

const turn = (chatId: string, text: string): Turn => ({
  id: `t${String((counter += 1))}`,
  channel: 'fake',
  chatId,
  text,
  status: 'sending',
});
const replierFor = (
  script: Step[],
  retryDelayMs = 0,
): { reply: Replier; engine: ScriptedEngine } => {
  const engine = new ScriptedEngine(script);
  const logger = createLogger('silent');
  const timing = { retryDelayMs, typingIntervalMs: 5, turnTimeoutMs: 5000 };
  return {
    engine,
    reply: createReplier({ db, engine, logger, model: 'test', ...timing }),
  };
};

it('shows typing, answers, and gives the next message the conversation so far', async () => {
  const { reply, engine } = replierFor([{ text: 'one' }, { text: 'two' }]);
  const channel = new FakeChannel();
  expect(await reply(turn('c1', 'first'), channel)).toBe('one');
  expect(channel.typings).toContain('c1');
  expect(await reply(turn('c1', 'second'), channel)).toBe('two');
  expect(engine.opened[1]?.history).toEqual([
    { role: 'user', text: 'first' },
    { role: 'assistant', text: 'one' },
  ]);
});

it('/new forgets the chat and leaves other chats alone', async () => {
  const { reply, engine } = replierFor([{ text: 'a' }, { text: 'b' }, { text: 'c' }]);
  const channel = new FakeChannel();
  await reply(turn('c2', 'hello'), channel);
  await reply(turn('c3', 'hello'), channel);
  expect(await reply(turn('c2', ' /new '), channel)).toBe(NEW_REPLY);
  await reply(turn('c2', 'again'), channel);
  await reply(turn('c3', 'again'), channel);
  expect(engine.opened[2]?.history).toEqual([]);
  expect(engine.opened[3]?.history).toHaveLength(2);
});

it('retries a transient model error twice, then answers', async () => {
  const { reply, engine } = replierFor([
    { error: 'transient' },
    { error: 'transient' },
    { text: 'ok' },
  ]);
  expect(await reply(turn('c4', 'hi'), new FakeChannel())).toBe('ok');
  expect(engine.opened).toHaveLength(3);
});

it('after two retries tells the user in one plain sentence and remembers nothing', async () => {
  const script: Step[] = [{ error: 'transient' }, { error: 'transient' }, { error: 'transient' }];
  const { reply, engine } = replierFor(script);
  expect(await reply(turn('c5', 'hi'), new FakeChannel())).toBe(FAILURE_REPLY);
  expect(engine.opened).toHaveLength(3);
  const next = replierFor([{ text: 'x' }]);
  await next.reply(turn('c5', 'again'), new FakeChannel());
  expect(next.engine.opened[0]?.history).toEqual([]);
});

it('does not retry a refused key', async () => {
  const { reply, engine } = replierFor([{ error: 'failed' }, { text: 'never' }]);
  expect(await reply(turn('c6', 'hi'), new FakeChannel())).toBe(FAILURE_REPLY);
  expect(engine.opened).toHaveLength(1);
});

it('an abort stops the turn while the model is waiting', async () => {
  const { reply, engine } = replierFor([{ hang: true }]);
  const controller = new AbortController();
  const answer = reply(turn('c7', 'hi'), new FakeChannel(), controller.signal);
  await vi.waitFor(() => {
    expect(engine.prompts).toEqual(['hi']);
  });
  controller.abort();
  expect(await answer).toBe(STOPPED_REPLY);
});

it('an abort during the wait before a retry stops the turn at once', async () => {
  const { reply, engine } = replierFor([{ error: 'transient' }, { text: 'never' }], 60_000);
  const controller = new AbortController();
  const answer = reply(turn('c7', 'hi'), new FakeChannel(), controller.signal);
  await vi.waitFor(() => {
    expect(engine.opened).toHaveLength(1);
  });
  controller.abort();
  expect(await answer).toBe(STOPPED_REPLY);
  expect(engine.opened).toHaveLength(1);
});

it('/new and /new@BotName both start over', async () => {
  const { reply } = replierFor([]);
  expect(await reply(turn('c10', '/new'), new FakeChannel())).toBe(NEW_REPLY);
  expect(await reply(turn('c10', '/new@MorganBot'), new FakeChannel())).toBe(NEW_REPLY);
});

it('keeps recent history within the character budget and never starts on an answer', async () => {
  const chat = { channel: 'fake', chatId: 'c11' };
  await appendHistory(db, chat, [
    { role: 'user', text: 'a'.repeat(50) },
    { role: 'assistant', text: 'b'.repeat(50) },
    { role: 'user', text: 'c'.repeat(50) },
    { role: 'assistant', text: 'd'.repeat(50) },
  ]);
  const kept = await loadHistory(db, chat, 40, 120);
  expect(kept.map((m) => m.text[0])).toEqual(['c', 'd']);
  expect(await loadHistory(db, chat, 40, 160)).toHaveLength(2);
  expect(await loadHistory(db, chat, 3, 1000)).toHaveLength(2);
});

const workerDeps = (channel: FakeChannel, reply: Replier) => {
  const nothing = () => Promise.resolve();
  const queue = { start: nothing, enqueue: nothing, work: nothing, stop: nothing };
  const logger = createLogger('silent');
  const identity = createIdentity(db);
  const aborts = createTurnAborts();
  return { db, queue, senders: [channel], logger, retryDelayMs: 0, identity, reply, aborts };
};

it('the worker sends the model answer as the reply', async () => {
  const { reply } = replierFor([{ text: 'from the model' }]);
  const channel = new FakeChannel();
  const created = await insertTurn(db, {
    idempotencyKey: 'fake:c8:1',
    channel: 'fake',
    chatId: 'c8',
    text: 'question',
  });
  await processTurn(workerDeps(channel, reply), created.id);
  expect(channel.attempts).toEqual([{ chatId: 'c8', text: 'from the model' }]);
  expect((await getTurn(db, created.id))?.status).toBe('done');
});

it('/stop from the same chat aborts the running turn; /stop with nothing running does nothing', async () => {
  const { reply, engine } = replierFor([{ hang: true }]);
  const channel = new FakeChannel();
  const deps = workerDeps(channel, reply);
  const stop = (id: string) => ({
    channel: 'fake',
    chatId: 'c9',
    messageId: id,
    text: '/stop@MorganBot',
  });
  await ingest(deps, stop('1'));
  expect(channel.attempts).toEqual([]);
  const created = await insertTurn(db, {
    idempotencyKey: 'fake:c9:2',
    channel: 'fake',
    chatId: 'c9',
    text: 'a long question',
  });
  const running = processTurn(deps, created.id);
  await vi.waitFor(() => {
    expect(engine.prompts).toEqual(['a long question']);
  });
  await ingest(deps, { ...stop('3'), chatId: 'c8' });
  await ingest(deps, stop('3'));
  await running;
  expect(channel.attempts).toEqual([{ chatId: 'c9', text: STOPPED_REPLY }]);
});
