import { sql } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createReplier, type Replier } from '../../src/core/index.js';
import {
  createDb,
  migrateToLatest,
  withOwner,
  type Db,
  type Owner,
  type Turn,
} from '../../src/data/index.js';
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
    Array.from({ length: 12 }, (_, k) => `k${String(k + 1)}`),
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

/** A threshold of 1000 tokens keeps the newest 1332 characters; each turn below is about 1000. */
const AT = 1000;
const LONG = 'x'.repeat(500);
const replierFor = (
  script: Step[],
  extra: Partial<Parameters<typeof createReplier>[0]> = {},
): { reply: Replier; engine: ScriptedEngine } => {
  const engine = new ScriptedEngine(script);
  const reply = createReplier({
    db,
    engine,
    logger: createLogger('silent'),
    model: 'test',
    timezone: 'UTC',
    retryDelayMs: 0,
    typingIntervalMs: 5,
    turnTimeoutMs: 5000,
    compactAtTokens: AT,
    ...extra,
  });
  return { reply, engine };
};
const say = async (reply: Replier, chatId: string, text: string): Promise<string> =>
  reply(turn(chatId, `${text} ${LONG}`), new FakeChannel());

const rows = (chatId: string) =>
  withOwner(db, who, (trx) =>
    trx
      .selectFrom('chat_messages')
      .select(['id', 'role', 'covers_from', 'covers_to'])
      .where('chat_id', '=', chatId)
      .orderBy('id')
      .execute(),
  );
const ledger = (chatId: string) =>
  withOwner(db, who, async (trx) => {
    const found = await sql<{
      n: string;
    }>`select count(*) as n from usage_ledger where chat_id = ${chatId}`.execute(trx);
    return Number(found.rows[0]?.n);
  });

it('never compacts under the threshold', async () => {
  const { reply, engine } = replierFor([
    { text: `a ${LONG}`, tokens: AT - 1 },
    { text: `b ${LONG}`, tokens: AT - 1 },
    { text: `c ${LONG}`, tokens: AT - 1 },
  ]);
  for (const word of ['one', 'two', 'three']) await say(reply, 'k1', word);
  expect(engine.opened).toHaveLength(3);
  expect((await rows('k1')).filter((r) => r.role === 'summary')).toEqual([]);
});

/** Three turns, the third filling the context; then two more. Turn 4 follows the summary call. */
async function longChat(chatId: string) {
  const { reply, engine } = replierFor([
    { text: `a ${LONG}`, tokens: 100 },
    { text: `b ${LONG}`, tokens: 100 },
    { text: `c ${LONG}`, tokens: AT },
    { text: 'THE SUMMARY', tokens: 50 },
    { text: 'd', tokens: 100 },
    { text: 'e', tokens: 100 },
  ]);
  for (const word of ['one', 'two', 'three', 'four', 'five']) await say(reply, chatId, word);
  return engine;
}

it('asks for the summary on a fresh session, with the old turns fenced as untrusted data', async () => {
  const engine = await longChat('k2');
  expect(engine.opened[3]?.history).toEqual([]);
  expect(engine.opened[3]?.system).toContain('untrusted');
  const sent = engine.prompts[3] ?? '';
  expect(sent).toContain('<<<UNTRUSTED CONTENT');
  expect(sent).toContain('Person: [Now:');
  expect(sent).toContain('Morgan: a x');
  expect(sent).not.toContain('three');
});

it('shows the summary to the model as fenced data, ahead of the newest turn', async () => {
  const next = (await longChat('k8')).opened[4]?.history ?? [];
  expect(next.map((m) => m.role)).toEqual(['user', 'user', 'assistant']);
  expect(next[0]?.text).toContain('THE SUMMARY');
  expect(next[0]?.text).toContain('<<<UNTRUSTED CONTENT');
  expect(next[1]?.text).toContain('three');
});

it('compacts once, keeps the replaced rows, and writes a ledger row for the summary call', async () => {
  await longChat('k9');
  const stored = await rows('k9');
  const [summary, ...more] = stored.filter((r) => r.role === 'summary');
  expect(more).toEqual([]);
  const originals = stored.filter((r) => r.role !== 'summary');
  expect(originals).toHaveLength(10);
  expect(summary).toMatchObject({ covers_from: originals[0]?.id, covers_to: originals[3]?.id });
  expect(await ledger('k9')).toBe(6);
});

it('cuts only at the start of a user message, so tool calls stay with their results', async () => {
  const gate = createGate({ db, logger: createLogger('silent'), timezone: 'UTC' });
  const { reply, engine } = replierFor(
    [
      { text: `a ${LONG}`, tokens: 100 },
      { tool: 'clock_now', args: {} },
      { text: 'b', tokens: AT },
      { text: 'SUMMARY', tokens: 50 },
      { text: 'c', tokens: 100 },
    ],
    { gate },
  );
  await say(reply, 'k3', 'one');
  await say(reply, 'k3', 'time?');
  await say(reply, 'k3', 'more');
  const history = engine.opened[3]?.history ?? [];
  expect(history.map((m) => m.role)).toEqual(['user', 'user', 'assistant', 'tool', 'assistant']);
  const stored = await rows('k3');
  const summary = stored.find((r) => r.role === 'summary');
  const end = stored.findIndex((r) => r.id === summary?.covers_to);
  expect(stored[end + 1]?.role).toBe('user');
});

it('runs the beforeCompact hook with what is replaced; a hook that fails costs no answer', async () => {
  const seen: number[] = [];
  const ok = replierFor(
    [
      { text: `a ${LONG}`, tokens: 100 },
      { text: `b ${LONG}`, tokens: AT },
      { text: 'S', tokens: 5 },
    ],
    {
      beforeCompact: (messages) => {
        seen.push(messages.length);
        return Promise.resolve();
      },
    },
  );
  await say(ok.reply, 'k4', 'one');
  await say(ok.reply, 'k4', 'two');
  expect(seen).toEqual([2]);
  const bad = replierFor(
    [
      { text: `a ${LONG}`, tokens: 100 },
      { text: `b ${LONG}`, tokens: AT },
    ],
    { beforeCompact: () => Promise.reject(new Error('no')) },
  );
  await say(bad.reply, 'k5', 'one');
  expect(await say(bad.reply, 'k5', 'two')).toBe(`b ${LONG}`);
  expect((await rows('k5')).filter((r) => r.role === 'summary')).toEqual([]);
});

it('does nothing when only the newest turn exists', async () => {
  const { reply, engine } = replierFor([{ text: `a ${LONG}`, tokens: AT * 5 }]);
  await say(reply, 'k6', 'one');
  expect(engine.opened).toHaveLength(1);
  expect((await rows('k6')).filter((r) => r.role === 'summary')).toEqual([]);
});
