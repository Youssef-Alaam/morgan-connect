import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  appendHistory,
  createDb,
  loadHistory,
  migrateToLatest,
  planCompaction,
  saveSummary,
  withOwner,
  type ChatKey,
  type ChatMessage,
  type Db,
  type Owner,
} from '../../src/data/index.js';
import { linkChats } from '../helpers/link-chats.js';
import { startPostgres, type TestPostgres } from '../helpers/postgres.js';

let postgres: TestPostgres;
let db: Db;
let who: Owner;

beforeAll(async () => {
  postgres = await startPostgres();
  db = createDb(postgres.url);
  await migrateToLatest(db);
  who = await linkChats(db, ['s1', 's2', 's3']);
}, 180_000);

afterAll(async () => {
  await db.destroy();
  await postgres.stop();
});

const chat = (chatId: string): ChatKey => ({ channel: 'fake', chatId });
const TURN: ChatMessage[] = [
  { role: 'user', text: 'u'.repeat(100) },
  { role: 'assistant', text: 'a'.repeat(100) },
];
const TOOL_TURN: ChatMessage[] = [
  { role: 'user', text: 'time?' },
  { role: 'assistant', text: '', toolCalls: [{ id: 'k1', name: 'clock_now', args: {} }] },
  { role: 'tool', text: '10:30', id: 'k1', name: 'clock_now', isError: false },
  { role: 'assistant', text: 'It is 10:30' },
];
const add = (chatId: string, ...turns: ChatMessage[][]): Promise<void> =>
  appendHistory(db, chat(chatId), turns.flat(), who);
const ids = (chatId: string): Promise<string[]> =>
  withOwner(db, who, async (trx) =>
    (
      await trx
        .selectFrom('chat_messages')
        .select('id')
        .where('chat_id', '=', chatId)
        .orderBy('id')
        .execute()
    ).map((r) => r.id),
  );

it('plans a cut at the start of the newest turns that fit, never inside a tool turn', async () => {
  await add('s1', TURN, TOOL_TURN, TURN);
  const all = await ids('s1');
  const plan = await planCompaction(db, who, chat('s1'), 210);
  expect(plan).toMatchObject({ fromId: all[0], toId: all[5], previous: undefined });
  expect(plan?.messages.map((m) => m.role)).toEqual([
    'user',
    'assistant',
    'user',
    'assistant',
    'tool',
    'assistant',
  ]);
  const wide = await planCompaction(db, who, chat('s1'), 100_000);
  expect(wide).toBeUndefined();
  const narrow = await planCompaction(db, who, chat('s1'), 0);
  expect(narrow?.toId).toBe(all[5]);
});

it('loads the summary first, then only what came after the part it replaced', async () => {
  await add('s2', TURN, TURN, TOOL_TURN);
  const all = await ids('s2');
  await saveSummary(db, who, chat('s2'), { fromId: all[0] ?? '', toId: all[3] ?? '', text: 'S1' });
  const loaded = await loadHistory(db, who, chat('s2'), { turns: 20, maxChars: 24_000 });
  expect(loaded.map((m) => m.role)).toEqual(['summary', 'user', 'assistant', 'tool', 'assistant']);
  expect(loaded[0]).toEqual({ role: 'summary', text: 'S1' });
  expect(await ids('s2')).toHaveLength(9);
  const plan = await planCompaction(db, who, chat('s2'), 0);
  expect(plan).toBeUndefined();
  await add('s2', TURN);
  const again = await planCompaction(db, who, chat('s2'), 0);
  expect(again).toMatchObject({ previous: 'S1', fromId: all[4] });
  await saveSummary(db, who, chat('s2'), {
    fromId: again?.fromId ?? '',
    toId: again?.toId ?? '',
    text: 'S2',
  });
  const latest = await loadHistory(db, who, chat('s2'), { turns: 20, maxChars: 24_000 });
  expect(latest.map((m) => m.text)).toEqual(['S2', 'u'.repeat(100), 'a'.repeat(100)]);
});

it('keeps a chat without a summary exactly as before', async () => {
  await add('s3', TURN);
  const loaded = await loadHistory(db, who, chat('s3'), { turns: 20, maxChars: 24_000 });
  expect(loaded).toEqual(TURN);
});
