import { afterAll, beforeAll, expect, it } from 'vitest';
import { start, type Running } from '../../src/boot.js';
import { roleUrls, startPostgres, type TestPostgres } from '../helpers/postgres.js';
import { readEvents } from '../helpers/sse.js';
import { seedWebSession } from '../helpers/web-session.js';

/** STANDARDS section 8: the first sign of life for a message must arrive within a second. */
const ACK_BUDGET_MS = 1000;
const MESSAGES = 20;

let postgres: TestPostgres;
let running: Running;
let cookie = '';

beforeAll(async () => {
  postgres = await startPostgres();
  cookie = await seedWebSession(postgres.url);
  running = await start({ ...roleUrls(postgres.url), PORT: '0', LOG_LEVEL: 'silent' });
}, 180_000);
afterAll(async () => {
  await running.stop();
  await postgres.stop();
});

it('acknowledges a web message on the stream within 1 s', async () => {
  const base = `http://127.0.0.1:${String(running.port)}/api/chat`;
  const waits: number[] = [];
  let seen = '0';
  for (let n = 0; n < MESSAGES; n += 1) {
    const stream = await fetch(`${base}/events`, {
      headers: { cookie, 'last-event-id': seen },
    });
    const began = performance.now();
    await fetch(base, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'ping', messageId: `p${String(n)}` }),
    });
    // The echo reply comes right after the ack, so this time is an upper bound for the ack.
    const [ack, reply] = await readEvents(stream, 2);
    waits.push(performance.now() - began);
    expect(ack?.event).toBe('ack');
    seen = reply?.id ?? seen;
  }
  const worst = Math.max(...waits);
  process.stdout.write(`perf: web ack worst ${worst.toFixed(1)} ms over ${String(MESSAGES)}\n`);
  expect(worst).toBeLessThanOrEqual(ACK_BUDGET_MS);
}, 180_000);
