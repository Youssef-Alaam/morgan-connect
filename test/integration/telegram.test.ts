import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { start } from '../../src/boot.js';
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

it('echoes a Telegram text message back to the same chat', async () => {
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
