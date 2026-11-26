import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { start } from '../../src/boot.js';
import { createDb, migrateToLatest, type Db } from '../../src/data/index.js';
import { ScriptedEngine } from '../helpers/fake-engine.js';
import { startFakeTelegram } from '../helpers/fake-telegram.js';
import { linkChats } from '../helpers/link-chats.js';
import { roleUrls, startPostgres, type TestPostgres } from '../helpers/postgres.js';

let postgres: TestPostgres;
let db: Db;

beforeAll(async () => {
  postgres = await startPostgres();
  db = createDb(postgres.url);
  await migrateToLatest(db);
  const admin = await linkChats(db, ['1'], 'telegram');
  // Telegram chat 42 belongs to a member: the admin is never limited.
  const member = await db
    .insertInto('users')
    .values({ role: 'member', workspace_id: admin.workspaceId })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('devices')
    .values({ user_id: member.id, channel: 'telegram', chat_id: '42' })
    .execute();
}, 180_000);
afterAll(async () => {
  await db.destroy();
  await postgres.stop();
});

it('answers a message over the limit with the fixed line and an Ask for more button, and no model call', async () => {
  const telegram = await startFakeTelegram({ rejectToken: false, messageId: 31 });
  const engine = new ScriptedEngine([{ text: 'should not be asked' }]);
  const running = await start(
    {
      ...roleUrls(postgres.url),
      PORT: '0',
      LOG_LEVEL: 'silent',
      TELEGRAM_BOT_TOKEN: '123:fake-token',
      TELEGRAM_API_ROOT: telegram.apiRoot,
      ANTHROPIC_API_KEY: 'sk-test',
      DEFAULT_MONTHLY_LIMIT_USD: '0',
    },
    { engine },
  );
  try {
    await vi.waitFor(
      () => {
        expect(telegram.sent).toHaveLength(1);
      },
      { timeout: 30_000 },
    );
    const body = telegram.sent[0] as { text: string; reply_markup: unknown };
    expect(body.text).toBe("You've reached this month's limit.");
    const markup = (
      typeof body.reply_markup === 'string' ? JSON.parse(body.reply_markup) : body.reply_markup
    ) as { inline_keyboard: { text: string; callback_data: string }[][] };
    expect(markup.inline_keyboard[0]).toMatchObject([{ text: 'Ask for more' }]);
    expect(engine.opened).toEqual([]);
    telegram.push({
      update_id: 900,
      callback_query: {
        id: 'cb900',
        from: { id: 42, is_bot: false, first_name: 'A' },
        chat_instance: 'ci',
        data: markup.inline_keyboard[0]?.[0]?.callback_data,
        message: { message_id: 6, date: 1, chat: { id: 42, type: 'private' }, text: 'q' },
      },
    });
    await vi.waitFor(
      () => {
        expect(telegram.answers).toHaveLength(1);
      },
      { timeout: 30_000 },
    );
    expect(telegram.answers[0]).toMatchObject({ text: 'Not available yet' });
  } finally {
    await running.stop();
    await telegram.stop();
  }
});
