import { afterAll, beforeAll, expect, it } from 'vitest';
import { start, type Running } from '../../src/boot.js';
import { roleUrls, startPostgres, type TestPostgres } from '../helpers/postgres.js';
import { readEvents } from '../helpers/sse.js';
import { seedWebSession } from '../helpers/web-session.js';

let postgres: TestPostgres;
let running: Running;
let cookie = '';

beforeAll(async () => {
  postgres = await startPostgres();
  cookie = await seedWebSession(postgres.url);
  // No Telegram token: the web chat alone must start the queue and answer.
  running = await start({ ...roleUrls(postgres.url), PORT: '0', LOG_LEVEL: 'silent' });
}, 180_000);
afterAll(async () => {
  await running.stop();
  await postgres.stop();
});

it('answers a web message over the real server, queue and worker, without Telegram', async () => {
  const base = `http://127.0.0.1:${String(running.port)}/api/chat`;
  const stream = await fetch(`${base}/events`, { headers: { cookie } });
  const sent = await fetch(base, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'ping', messageId: 'boot-1' }),
  });
  expect(sent.status).toBe(202);
  const events = await readEvents(stream, 2);
  expect(events.map((e) => [e.event, e.data.ref ?? e.data.text])).toEqual([
    ['ack', 'boot-1'],
    ['message', 'ping'],
  ]);
});
