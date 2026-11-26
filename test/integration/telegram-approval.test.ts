import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { start } from '../../src/boot.js';
import { createDb, migrateToLatest, type Db } from '../../src/data/index.js';
import { ScriptedEngine, type Step } from '../helpers/fake-engine.js';
import { startFakeTelegram, type FakeTelegram } from '../helpers/fake-telegram.js';
import { linkChats } from '../helpers/link-chats.js';
import { roleUrls, startPostgres, type TestPostgres } from '../helpers/postgres.js';

let postgres: TestPostgres;
let db: Db;

beforeAll(async () => {
  postgres = await startPostgres();
  db = createDb(postgres.url);
  await migrateToLatest(db);
  await linkChats(db, ['42'], 'telegram');
}, 180_000);

afterAll(async () => {
  await db.destroy();
  await postgres.stop();
});

const tap = (data: string, chatId: number, updateId: number): unknown => ({
  update_id: updateId,
  callback_query: {
    id: `cb${String(updateId)}`,
    from: { id: chatId, is_bot: false, first_name: 'A' },
    chat_instance: 'ci',
    data,
    message: { message_id: 6, date: 1, chat: { id: chatId, type: 'private' }, text: 'q' },
  },
});

/** The Approve and Deny callback data of the question the bot sent. */
function buttons(telegram: FakeTelegram): { approve: string; deny: string } {
  const body = telegram.sent[0] as { reply_markup: unknown; text: string };
  const markup = (
    typeof body.reply_markup === 'string' ? JSON.parse(body.reply_markup) : body.reply_markup
  ) as { inline_keyboard: { text: string; callback_data: string }[][] };
  const row = markup.inline_keyboard[0] ?? [];
  expect(row.map((b) => b.text)).toEqual(['Approve', 'Deny']);
  expect(body.text).toContain('"note": "hi"');
  return { approve: row[0]?.callback_data ?? '', deny: row[1]?.callback_data ?? '' };
}

async function run(steps: Step[], messageId: number) {
  const telegram = await startFakeTelegram({ rejectToken: false, messageId });
  const running = await start(
    {
      ...roleUrls(postgres.url),
      PORT: '0',
      LOG_LEVEL: 'silent',
      TELEGRAM_BOT_TOKEN: '123:fake-token',
      TELEGRAM_API_ROOT: telegram.apiRoot,
      ANTHROPIC_API_KEY: 'sk-test',
      DEMO_TOOLS: 'true',
    },
    { engine: new ScriptedEngine(steps) },
  );
  const stop = async (): Promise<void> => {
    await running.stop();
    await telegram.stop();
  };
  return { telegram, stop };
}

const lastAudit = () =>
  db
    .selectFrom('audit_log')
    .select(['tool', 'decision', 'outcome'])
    .orderBy('id', 'desc')
    .limit(1)
    .execute();
const within = { timeout: 30_000 };

it('shows buttons, runs the tool only after Approve, and cannot be approved twice', async () => {
  const { telegram, stop } = await run(
    [{ tool: 'demo_gated', args: { note: 'hi' } }, { text: 'all done' }],
    9,
  );
  try {
    await vi.waitFor(() => {
      expect(telegram.sent).toHaveLength(1);
    }, within);
    expect(await lastAudit()).toEqual([]);
    const { approve } = buttons(telegram);
    telegram.push(tap(approve, 42, 100));
    await vi.waitFor(() => {
      expect(telegram.sent[1]).toMatchObject({ text: 'all done' });
    }, within);
    telegram.push(tap(approve, 42, 101));
    await vi.waitFor(() => {
      expect(telegram.answers).toHaveLength(2);
    }, within);
    expect(telegram.answers).toMatchObject([{ text: 'Approved' }, { text: 'No longer valid' }]);
    expect(await lastAudit()).toEqual([{ tool: 'demo.gated', decision: 'ask', outcome: 'ok' }]);
  } finally {
    await stop();
  }
});

it('ignores a tap from another chat, and tells the model after Deny', async () => {
  const { telegram, stop } = await run(
    [{ tool: 'demo_gated', args: { note: 'hi' } }, { text: 'ok, not done' }],
    10,
  );
  try {
    await vi.waitFor(() => {
      expect(telegram.sent).toHaveLength(1);
    }, within);
    const { approve, deny } = buttons(telegram);
    telegram.push(tap(approve, 99, 200));
    await vi.waitFor(() => {
      expect(telegram.answers).toHaveLength(1);
    }, within);
    expect(telegram.answers[0]).toMatchObject({ text: 'No longer valid' });
    telegram.push(tap(deny, 42, 201));
    await vi.waitFor(() => {
      expect(telegram.sent[1]).toMatchObject({ text: 'ok, not done' });
    }, within);
    expect(await lastAudit()).toEqual([{ tool: 'demo.gated', decision: 'ask', outcome: 'denied' }]);
  } finally {
    await stop();
  }
});
