import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  FAILURE_REPLY,
  NEW_REPLY,
  STOPPED_REPLY,
  createReplier,
  processTurn,
  type Replier,
} from '../../src/core/index.js';
import {
  createDb,
  getTurn,
  insertTurn,
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
const replierFor = (script: Step[]): { reply: Replier; engine: ScriptedEngine } => {
  const engine = new ScriptedEngine(script);
  const logger = createLogger('silent');
  const timing = { retryDelayMs: 0, typingIntervalMs: 5, turnTimeoutMs: 5000 };
  return { engine, reply: createReplier({ db, engine, logger, ...timing }) };
};

it('answers and gives the next message the conversation so far', async () => {
  const { reply, engine } = replierFor([{ text: 'one' }, { text: 'two' }]);
  expect(await reply(turn('c1', 'first'))).toBe('one');
  expect(await reply(turn('c1', 'second'))).toBe('two');
  expect(engine.opened[1]?.history).toEqual([
    { role: 'user', text: 'first' },
    { role: 'assistant', text: 'one' },
  ]);
});

it('/new forgets the chat and leaves other chats alone', async () => {
  const { reply, engine } = replierFor([{ text: 'a' }, { text: 'b' }, { text: 'c' }]);
  await reply(turn('c2', 'hello'));
  await reply(turn('c3', 'hello'));
  expect(await reply(turn('c2', ' /new '))).toBe(NEW_REPLY);
  await reply(turn('c2', 'again'));
  await reply(turn('c3', 'again'));
  expect(engine.opened[2]?.history).toEqual([]);
  expect(engine.opened[3]?.history).toHaveLength(2);
});

it('retries a transient model error twice, then answers', async () => {
  const { reply, engine } = replierFor([
    { error: 'transient' },
    { error: 'transient' },
    { text: 'ok' },
  ]);
  expect(await reply(turn('c4', 'hi'))).toBe('ok');
  expect(engine.opened).toHaveLength(3);
});

it('after two retries tells the user in one plain sentence and remembers nothing', async () => {
  const script: Step[] = [{ error: 'transient' }, { error: 'transient' }, { error: 'transient' }];
  const { reply, engine } = replierFor(script);
  expect(await reply(turn('c5', 'hi'))).toBe(FAILURE_REPLY);
  expect(engine.opened).toHaveLength(3);
  const next = replierFor([{ text: 'x' }]);
  await next.reply(turn('c5', 'again'));
  expect(next.engine.opened[0]?.history).toEqual([]);
});

it('does not retry a refused key', async () => {
  const { reply, engine } = replierFor([{ error: 'failed' }, { text: 'never' }]);
  expect(await reply(turn('c6', 'hi'))).toBe(FAILURE_REPLY);
  expect(engine.opened).toHaveLength(1);
});

it('an abort stops the turn', async () => {
  const { reply, engine } = replierFor([{ hang: true }]);
  const controller = new AbortController();
  const answer = reply(turn('c7', 'hi'), controller.signal);
  controller.abort();
  expect(await answer).toBe(STOPPED_REPLY);
  expect(engine.opened).toHaveLength(1);
});

it('the worker sends the model answer as the reply', async () => {
  const { reply } = replierFor([{ text: 'from the model' }]);
  const channel = new FakeChannel();
  const created = await insertTurn(db, {
    idempotencyKey: 'fake:c8:1',
    channel: 'fake',
    chatId: 'c8',
    text: 'question',
  });
  const nothing = () => Promise.resolve();
  const queue = { start: nothing, enqueue: nothing, work: nothing, stop: nothing };
  const logger = createLogger('silent');
  const identity = createIdentity(db);
  const deps = { db, queue, senders: [channel], logger, retryDelayMs: 0, identity, reply };
  await processTurn(deps, created.id);
  expect(channel.attempts).toEqual([{ chatId: 'c8', text: 'from the model' }]);
  expect((await getTurn(db, created.id))?.status).toBe('done');
});
