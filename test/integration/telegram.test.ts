import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { sql } from 'kysely';
import { start } from '../../src/boot.js';
import { createDb, migrateToLatest } from '../../src/data/index.js';
import { startFakeTelegram } from '../helpers/fake-telegram.js';
import { startPostgres, type TestPostgres } from '../helpers/postgres.js';

let postgres: TestPostgres;

beforeAll(async () => {
  postgres = await startPostgres();
}, 180_000);

afterAll(async () => {
  await postgres.stop();
});

const env = (apiRoot: string): Record<string, string> => ({
  DATABASE_URL: postgres.url,
  PORT: '0',
  LOG_LEVEL: 'silent',
  TELEGRAM_BOT_TOKEN: '123:fake-token',
  TELEGRAM_API_ROOT: apiRoot,
});

/** Link chat 42 (the fake update's chat) so the gate lets it through. */
async function linkChat42(): Promise<void> {
  const db = createDb(postgres.url);
  await migrateToLatest(db);
  await sql`insert into users (id) values ('00000000-0000-0000-0000-000000000042')`.execute(db);
  await sql`insert into devices (user_id, channel, chat_id) values ('00000000-0000-0000-0000-000000000042', 'telegram', '42')`.execute(
    db,
  );
  await db.destroy();
}

it('echoes a Telegram text message back to a linked chat', async () => {
  await linkChat42();
  const telegram = await startFakeTelegram({ rejectToken: false });
  const running = await start(env(telegram.apiRoot));
  try {
    await vi.waitFor(
      () => {
        expect(telegram.sent).toMatchObject([{ chat_id: '42', text: 'ping' }]);
      },
      { timeout: 30_000 },
    );
  } finally {
    await running.stop();
    await telegram.stop();
  }
});

it('fails to start, and releases the queue, when Telegram rejects the token', async () => {
  const telegram = await startFakeTelegram({ rejectToken: true });
  try {
    await expect(start(env(telegram.apiRoot))).rejects.toThrow();
  } finally {
    await telegram.stop();
  }
});
