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

interface Body {
  chat_id: number | string;
  text: string;
  reply_markup?: unknown;
}
const buttons = (body: Body) =>
  (
    (typeof body.reply_markup === 'string' ? JSON.parse(body.reply_markup) : body.reply_markup) as {
      inline_keyboard: { text: string; callback_data: string }[][];
    }
  ).inline_keyboard[0] ?? [];

const at = (list: Body[], i: number): Body => {
  const found = list[i];
  if (found === undefined) throw new Error(`no message at ${String(i)}`);
  return found;
};

const tapFrom = (id: number, data: string | undefined, type = 'private') => ({
  update_id: 900 + id + Math.abs(data?.length ?? 0),
  callback_query: {
    id: `cb${String(id)}${data ?? ''}`,
    from: { id, is_bot: false, first_name: 'A' },
    chat_instance: 'ci',
    data,
    message: { message_id: 6, date: 1, chat: { id, type }, text: 'q' },
  },
});

it('asks the admin on a tap, and an approval lets the member carry on', async () => {
  const telegram = await startFakeTelegram({ rejectToken: false, messageId: 31 });
  const engine = new ScriptedEngine([{ text: 'back at it' }]);
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
  const sentTo = (chat: number) => () =>
    telegram.sent.filter((m) => String((m as Body).chat_id) === String(chat)) as Body[];
  const answered = (n: number) => () => {
    expect(telegram.answers).toHaveLength(n);
  };
  try {
    await vi.waitFor(
      () => {
        expect(sentTo(42)()).toHaveLength(1);
      },
      { timeout: 30_000 },
    );
    const refusal = at(sentTo(42)(), 0);
    expect(refusal.text).toBe("You've reached this month's limit.");
    expect(buttons(refusal)).toMatchObject([{ text: 'Ask for more' }]);
    expect(engine.opened).toEqual([]);
    const ask = buttons(refusal)[0]?.callback_data;
    // A tap in a group, or by someone else, asks nothing.
    telegram.push(tapFrom(42, ask, 'group'));
    await vi.waitFor(answered(1), { timeout: 30_000 });
    expect(telegram.answers[0]).toMatchObject({ text: 'Not available' });
    expect(sentTo(1)()).toEqual([]);
    telegram.push(tapFrom(42, ask));
    await vi.waitFor(answered(2), { timeout: 30_000 });
    expect(telegram.answers[1]).toMatchObject({ text: 'Asked the admin' });
    telegram.push(tapFrom(42, ask));
    await vi.waitFor(answered(3), { timeout: 30_000 });
    expect(telegram.answers[2]).toMatchObject({ text: 'Already asked' });
    const question = sentTo(1)();
    expect(question).toHaveLength(1);
    expect(question[0]?.text).toContain('Add $5.00 for this month?');
    expect(buttons(at(question, 0)).map((b) => b.text)).toEqual(['Approve', 'Deny']);
    // Someone else tapping Approve (the member, in their own chat) changes nothing.
    const approve = buttons(at(question, 0))[0]?.callback_data;
    telegram.push(tapFrom(42, approve));
    await vi.waitFor(answered(4), { timeout: 30_000 });
    expect(telegram.answers[3]).toMatchObject({ text: 'No longer valid' });
    expect(sentTo(42)()).toHaveLength(1);
    telegram.push(tapFrom(1, approve));
    await vi.waitFor(
      () => {
        expect(sentTo(42)()).toHaveLength(2);
      },
      { timeout: 30_000 },
    );
    expect(sentTo(42)()[1]?.text).toBe("$5.00 was added to this month's limit. Carry on.");
    telegram.push({
      update_id: 950,
      message: { message_id: 8, date: 1, chat: { id: 42, type: 'private' }, text: 'again' },
    });
    await vi.waitFor(
      () => {
        expect(sentTo(42)()).toHaveLength(3);
      },
      { timeout: 30_000 },
    );
    expect(sentTo(42)()[2]?.text).toBe('back at it');
  } finally {
    await running.stop();
    await telegram.stop();
  }
});
