import { sql } from 'kysely';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import {
  FAILURE_REPLY,
  IDLE_REPLY,
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
  type Owner,
  type Turn,
} from '../../src/data/index.js';
import { createIdentity } from '../../src/identity/index.js';
import { createLogger } from '../../src/ops/index.js';
import { createGate } from '../../src/policy/index.js';
import { FakeChannel } from '../helpers/fake-channel.js';
import { ScriptedEngine, type Step } from '../helpers/fake-engine.js';
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
  who = await linkChats(
    db,
    Array.from({ length: 30 }, (_, k) => `c${String(k + 1)}`),
  );
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
  ...who,
});
/** What the model sees before each message when the zone is UTC and the clock is fixed. */
const STAMP = '[Now: Wed 25 Nov 2026 10:30 (UTC, UTC+00:00)] ';
const replierFor = (
  script: Step[],
  retryDelayMs = 0,
  extra: Partial<Parameters<typeof createReplier>[0]> = {},
): { reply: Replier; engine: ScriptedEngine } => {
  const engine = new ScriptedEngine(script);
  const logger = createLogger('silent');
  const timing = { retryDelayMs, typingIntervalMs: 5, turnTimeoutMs: 5000 };
  return {
    engine,
    reply: createReplier({
      db,
      engine,
      logger,
      model: 'test',
      timezone: 'UTC',
      now: () => new Date('2026-11-25T10:30:00Z'),
      ...timing,
      ...extra,
    }),
  };
};

it('shows typing, answers, and gives the next message the conversation so far', async () => {
  const { reply, engine } = replierFor([{ text: 'one' }, { text: 'two' }]);
  const channel = new FakeChannel();
  expect(await reply(turn('c1', 'first'), channel)).toBe('one');
  expect(channel.typings).toContain('c1');
  expect(await reply(turn('c1', 'second'), channel)).toBe('two');
  expect(engine.opened[1]?.history).toEqual([
    { role: 'user', text: `${STAMP}first` },
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

it('gives a chat one conversation id until /new, then a new one, and ends the old one', async () => {
  const { reply, engine } = replierFor([{ text: 'a' }, { text: 'b' }, { text: 'c' }]);
  const channel = new FakeChannel();
  await reply(turn('c11', 'one'), channel);
  await reply(turn('c11', 'two'), channel);
  const first = engine.opened[0]?.conversationId;
  expect(first).toMatch(/^[0-9a-f-]{36}$/);
  expect(engine.opened[1]?.conversationId).toBe(first);
  await reply(turn('c11', '/new'), channel);
  expect(engine.ended).toEqual([first]);
  await reply(turn('c11', 'three'), channel);
  const second = engine.opened[2]?.conversationId;
  expect(second).toMatch(/^[0-9a-f-]{36}$/);
  expect(second).not.toBe(first);
});

it('/new still works when the engine cannot end the conversation, and when none was started', async () => {
  const { reply, engine } = replierFor([{ text: 'a' }]);
  const channel = new FakeChannel();
  expect(await reply(turn('c12', '/new'), channel)).toBe(NEW_REPLY);
  expect(engine.ended).toEqual([]);
  await reply(turn('c12', 'hi'), channel);
  engine.endFails = true;
  expect(await reply(turn('c12', '/new'), channel)).toBe(NEW_REPLY);
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
    expect(engine.prompts).toEqual([`${STAMP}hi`]);
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
  await appendHistory(
    db,
    chat,
    [
      { role: 'user', text: 'a'.repeat(50) },
      { role: 'assistant', text: 'b'.repeat(50) },
      { role: 'user', text: 'c'.repeat(50) },
      { role: 'assistant', text: 'd'.repeat(50) },
    ],
    who,
  );
  const kept = await loadHistory(db, who, chat, { turns: 40, maxChars: 120 });
  expect(kept.map((m) => m.text[0])).toEqual(['c', 'd']);
  expect(await loadHistory(db, who, chat, { turns: 40, maxChars: 160 })).toHaveLength(2);
  expect(await loadHistory(db, who, chat, { turns: 1, maxChars: 1000 })).toHaveLength(2);
});

const clockReplier = (script: Step[]) => {
  const logger = createLogger('silent');
  const timezone = 'Asia/Riyadh';
  const now = () => new Date('2026-11-25T10:30:00Z');
  const gate = createGate({ db, logger, timezone });
  return replierFor(script, 0, { gate, timezone, now, logger });
};

it('replays an earlier tool call and its result to the model on the next turn', async () => {
  const { reply, engine } = clockReplier([
    { tool: 'clock_now', args: {} },
    { text: 'It is 13:30' },
    { text: 'Fine' },
  ]);
  await reply(turn('c12', 'time?'), new FakeChannel());
  await reply(turn('c12', 'thanks'), new FakeChannel());
  const history = engine.opened[1]?.history ?? [];
  expect(history.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
  expect(history[1]).toMatchObject({ toolCalls: [{ id: 'call-1', name: 'clock_now', args: {} }] });
  expect(history[2]).toMatchObject({ id: 'call-1', name: 'clock_now', isError: false });
  expect(history[2]?.text).toContain('(Asia/Riyadh, UTC+03:00)');
  expect(history[3]).toEqual({ role: 'assistant', text: 'It is 13:30' });
});

it('keeps the system prompt static and puts the local time in front of each message', async () => {
  const { reply, engine } = clockReplier([{ text: 'ok' }, { text: 'again' }]);
  await reply(turn('c13', 'hi'), new FakeChannel());
  await reply(turn('c13', 'more'), new FakeChannel());
  expect(engine.opened[0]?.system).toBe(engine.opened[1]?.system);
  expect(engine.opened[0]?.system).toContain('given at the start of each user message');
  expect(engine.prompts[0]).toBe('[Now: Wed 25 Nov 2026 13:30 (Asia/Riyadh, UTC+03:00)] hi');
  expect(engine.opened[1]?.history[0]).toEqual({
    role: 'user',
    text: '[Now: Wed 25 Nov 2026 13:30 (Asia/Riyadh, UTC+03:00)] hi',
  });
});

it('falls back to UTC for the time stamp when the zone is not valid', async () => {
  const { reply, engine } = replierFor([{ text: 'ok' }], 0, {
    timezone: 'Mars/Base',
    now: () => new Date('2026-11-25T10:30:00Z'),
  });
  await reply(turn('c21', 'hi'), new FakeChannel());
  expect(engine.prompts[0]).toBe('[Now: Wed 25 Nov 2026 10:30 (UTC, UTC+00:00)] hi');
});

it('trims only between user turns, so a tool call keeps its result', async () => {
  const chat = { channel: 'fake', chatId: 'c14' };
  const call = { id: 'x', name: 'clock_now', args: {} };
  await appendHistory(
    db,
    chat,
    [
      { role: 'user', text: 'old' },
      { role: 'assistant', text: '', toolCalls: [call] },
      { role: 'tool', text: 'noon', id: 'x', name: 'clock_now', isError: false },
      { role: 'assistant', text: 'done' },
      { role: 'user', text: 'new' },
      { role: 'assistant', text: 'ok' },
    ],
    who,
  );
  const last = await loadHistory(db, who, chat, { turns: 1, maxChars: 10_000 });
  expect(last.map((m) => m.role)).toEqual(['user', 'assistant']);
  expect(await loadHistory(db, who, chat, { turns: 2, maxChars: 10_000 })).toHaveLength(6);
  const budget = await loadHistory(db, who, chat, {
    turns: 2,
    maxChars: 'new'.length + 'ok'.length + 'done'.length,
  });
  expect(budget.map((m) => m.text)).toEqual(['new', 'ok']);
});

it('still loads rows saved before tool calls were kept', async () => {
  await sql`insert into chat_messages (user_id, workspace_id, channel, chat_id, role, text)
    select u.id, u.workspace_id, 'fake', 'c15', m.role, m.text from devices d join users u on u.id = d.user_id
    cross join (values ('user', 'q'), ('assistant', 'a')) as m (role, text)
    where d.chat_id = 'c15'`.execute(db);
  expect(
    await loadHistory(db, who, { channel: 'fake', chatId: 'c15' }, { turns: 40, maxChars: 24_000 }),
  ).toEqual([
    { role: 'user', text: 'q' },
    { role: 'assistant', text: 'a' },
  ]);
});

const hangingTool = {
  name: 'test.hang',
  description: 'never answers',
  actionType: 'read' as const,
  changesState: false,
  parameters: {},
  run: () => new Promise<string>(() => undefined),
};
const gateWith = (options: Partial<Parameters<typeof createGate>[0]>) =>
  createGate({ db, logger: createLogger('silent'), ...options });

it('remembers a stopped turn: the open tool call is closed as aborted, then a note', async () => {
  const gate = gateWith({ tools: [hangingTool] });
  const { reply, engine } = replierFor([{ tool: 'test_hang', args: {} }], 0, { gate });
  const controller = new AbortController();
  const answer = reply(turn('c16', 'wait'), new FakeChannel(), controller.signal);
  await vi.waitFor(() => {
    expect(engine.prompts).toEqual([`${STAMP}wait`]);
  });
  controller.abort();
  expect(await answer).toBe(STOPPED_REPLY);
  const kept = await loadHistory(
    db,
    who,
    { channel: 'fake', chatId: 'c16' },
    { turns: 20, maxChars: 24_000 },
  );
  expect(kept.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
  expect(kept[2]).toMatchObject({ isError: true, text: 'aborted' });
  expect(kept[3]).toEqual({ role: 'assistant', text: '(turn stopped)' });
});

it('does not retry a model hiccup once a tool has run, and keeps what happened', async () => {
  const { reply, engine } = clockReplier([
    { tool: 'clock_now', args: {} },
    { error: 'transient' },
    { text: 'never' },
  ]);
  expect(await reply(turn('c17', 'time?'), new FakeChannel())).toBe(FAILURE_REPLY);
  expect(engine.opened).toHaveLength(1);
  const kept = await loadHistory(
    db,
    who,
    { channel: 'fake', chatId: 'c17' },
    { turns: 20, maxChars: 24_000 },
  );
  expect(kept.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
});

it('stores a refused tool call as an error result', async () => {
  const off = {
    read: 'off',
    create: 'off',
    overwrite: 'off',
    delete: 'off',
    send: 'off',
    execute: 'off',
  } as const;
  const { reply } = replierFor([{ tool: 'clock_now', args: {} }, { text: 'sorry' }], 0, {
    gate: gateWith({ profile: off }),
  });
  await reply(turn('c18', 'time?'), new FakeChannel());
  const kept = await loadHistory(
    db,
    who,
    { channel: 'fake', chatId: 'c18' },
    { turns: 20, maxChars: 24_000 },
  );
  expect(kept[2]).toMatchObject({ role: 'tool', isError: true });
});

it('cuts a stored tool result to 4000 characters with a marker', async () => {
  const chat = { channel: 'fake', chatId: 'c19' };
  await appendHistory(
    db,
    chat,
    [
      { role: 'user', text: 'q' },
      { role: 'assistant', text: '', toolCalls: [{ id: 'a', name: 'big', args: {} }] },
      { role: 'tool', id: 'a', name: 'big', isError: false, text: 'x'.repeat(5000) },
      { role: 'assistant', text: 'ok' },
    ],
    who,
  );
  const kept = await loadHistory(db, who, chat, { turns: 20, maxChars: 24_000 });
  expect(kept[2]?.text).toHaveLength(4000 + ' [truncated]'.length);
  expect(kept[2]?.text.endsWith('[truncated]')).toBe(true);
});

it('counts user turns, not rows, and leaves out a turn with a damaged tool row', async () => {
  const chat = { channel: 'fake', chatId: 'c20' };
  const call = { id: 'z', name: 'clock_now', args: {} };
  await appendHistory(
    db,
    chat,
    [
      { role: 'user', text: 'broken' },
      { role: 'assistant', text: '', toolCalls: [call] },
      { role: 'tool', id: 'z', name: 'clock_now', isError: false, text: 'noon' },
      { role: 'assistant', text: 'done' },
    ],
    who,
  );
  await sql`update chat_messages set data = null where chat_id = 'c20' and role = 'tool'`.execute(
    db,
  );
  for (let n = 0; n < 3; n += 1) {
    await appendHistory(
      db,
      chat,
      [
        { role: 'user', text: `q${String(n)}` },
        { role: 'assistant', text: `a${String(n)}` },
      ],
      who,
    );
  }
  expect(
    (await loadHistory(db, who, chat, { turns: 20, maxChars: 24_000 })).map((m) => m.text),
  ).toEqual(['q0', 'a0', 'q1', 'a1', 'q2', 'a2']);
  expect(await loadHistory(db, who, chat, { turns: 2, maxChars: 24_000 })).toHaveLength(4);
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
  expect((await getTurn(db, who, created.id))?.status).toBe('done');
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
    expect(engine.prompts).toEqual([`${STAMP}a long question`]);
  });
  await ingest(deps, { ...stop('3'), chatId: 'c8' });
  await ingest(deps, stop('3'));
  await running;
  expect(channel.attempts).toEqual([{ chatId: 'c9', text: STOPPED_REPLY }]);
});

const MINUTE = 60_000;
const GAP = 360 * MINUTE;
/** A clock that runs `ahead` ms past the real one, so rows just written look that much older. */
const clockAhead = (ahead: () => number) => (): Date => new Date(Date.now() + ahead());

it('continues the conversation just under the idle gap and starts a new one just over it', async () => {
  let ahead = 0;
  const { reply, engine } = replierFor([{ text: 'a' }, { text: 'b' }, { text: 'c' }], 0, {
    now: clockAhead(() => ahead),
    idleGapMs: GAP,
  });
  const channel = new FakeChannel();
  await reply(turn('c24', 'one'), channel);
  const first = engine.opened[0]?.conversationId;
  ahead = GAP - MINUTE;
  expect(await reply(turn('c24', 'two'), channel)).toBe('b');
  expect(engine.opened[1]?.conversationId).toBe(first);
  expect(engine.opened[1]?.history).toHaveLength(2);
  expect(engine.ended).toEqual([]);
  ahead = 2 * GAP + MINUTE;
  expect(await reply(turn('c24', 'three'), channel)).toBe(`${IDLE_REPLY}

c`);
  expect(engine.opened[2]?.history).toEqual([]);
  expect(engine.opened[2]?.conversationId).not.toBe(first);
  expect(engine.ended).toEqual([first]);
});

it('does not announce a new conversation for a chat with no history, and ignores the gap when unset', async () => {
  const { reply, engine } = replierFor([{ text: 'a' }, { text: 'b' }], 0, {
    now: clockAhead(() => 10 * GAP),
    idleGapMs: GAP,
  });
  expect(await reply(turn('c25', 'first ever'), new FakeChannel())).toBe('a');
  expect(engine.ended).toEqual([]);
  const off = replierFor([{ text: 'a' }, { text: 'b' }], 0, { now: clockAhead(() => 10 * GAP) });
  await off.reply(turn('c26', 'one'), new FakeChannel());
  expect(await off.reply(turn('c26', 'two'), new FakeChannel())).toBe('b');
  expect(off.engine.opened[1]?.history).toHaveLength(2);
});

it('a turn still running when the gap passes is not cut', async () => {
  let ahead = 0;
  const { reply, engine } = replierFor([{ text: 'a' }, { hang: true }], 0, {
    now: clockAhead(() => ahead),
    idleGapMs: GAP,
  });
  const channel = new FakeChannel();
  await reply(turn('c27', 'one'), channel);
  const controller = new AbortController();
  const running = reply(turn('c27', 'two'), channel, controller.signal);
  await vi.waitFor(() => {
    expect(engine.prompts).toHaveLength(2);
  });
  ahead = 3 * GAP;
  expect(engine.ended).toEqual([]);
  controller.abort();
  expect(await running).toBe(STOPPED_REPLY);
  expect(engine.ended).toEqual([]);
});
