// The `pi-only` CI job runs this after an install that leaves every optional engine SDK out
// (A13: an install with only Pi must work). It boots the real stack with ENGINE=pi on the
// scripted fake engine and answers one message.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { start, type Running } from '../../src/boot.js';
import { ScriptedEngine } from '../helpers/fake-engine.js';
import { roleUrls, startPostgres, type TestPostgres } from '../helpers/postgres.js';
import { readEvents } from '../helpers/sse.js';
import { seedWebSession } from '../helpers/web-session.js';

let postgres: TestPostgres;
let running: Running;
let cookie = '';

beforeAll(async () => {
  postgres = await startPostgres();
  cookie = await seedWebSession(postgres.url);
  running = await start(
    { ...roleUrls(postgres.url), ENGINE: 'pi', PORT: '0', LOG_LEVEL: 'silent' },
    { engine: new ScriptedEngine([{ text: 'pong from the fake engine' }]) },
  );
}, 180_000);
afterAll(async () => {
  await running.stop();
  await postgres.stop();
});

it('boots with ENGINE=pi and answers one message through the fake engine', async () => {
  const base = `http://127.0.0.1:${String(running.port)}/api/chat`;
  const stream = await fetch(`${base}/events`, { headers: { cookie } });
  const sent = await fetch(base, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'ping', messageId: 'pi-1' }),
  });
  expect(sent.status).toBe(202);
  const events = await readEvents(stream, 2);
  expect(events.map((e) => [e.event, e.data.ref ?? e.data.text])).toEqual([
    ['ack', 'pi-1'],
    ['message', 'pong from the fake engine'],
  ]);
});
