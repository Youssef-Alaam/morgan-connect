import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  createSession,
  endSession,
  recordWebEvent,
  WEB_EVENT_KEEP,
  WEB_EVENT_PAGE,
  webEventsAfter,
} from '../../src/data/index.js';
import { startIsolation, type Isolation } from '../helpers/isolation.js';

let ctx: Isolation;
beforeAll(async () => {
  ctx = await startIsolation();
}, 180_000);
afterAll(async () => {
  await ctx.stop();
});

it('stores events in order, reads only those after an id, and acknowledges a message once', async () => {
  const { app, alice } = ctx;
  const first = await recordWebEvent(app, alice, 's1', { kind: 'ack', ref: 'm1' });
  expect(await recordWebEvent(app, alice, 's1', { kind: 'ack', ref: 'm1' })).toBeUndefined();
  const second = await recordWebEvent(app, alice, 's1', { kind: 'message', text: 'hi' });
  expect(await recordWebEvent(app, alice, 's1', { kind: 'message', text: 'hi' })).toBeDefined();
  const all = await webEventsAfter(app, alice, 's1', '0');
  expect(all.map((e) => [e.kind, e.ref, e.text])).toEqual([
    ['ack', 'm1', ''],
    ['message', null, 'hi'],
    ['message', null, 'hi'],
  ]);
  expect((await webEventsAfter(app, alice, 's1', first ?? '')).map((e) => e.id)).toHaveLength(2);
  expect(await webEventsAfter(app, alice, 's1', second ?? '')).toHaveLength(1);
});

it('drops a session events with the session', async () => {
  const { app, owner, alice } = ctx;
  const expiresAt = new Date(Date.now() + 60_000);
  const id = await createSession(app, alice, { tokenHash: 'ev-1', expiresAt });
  await recordWebEvent(app, alice, id, { kind: 'message', text: 'x' });
  await endSession(app, alice, id);
  expect(await webEventsAfter(app, alice, id, '0')).toEqual([]);
  const gone = await createSession(app, alice, { tokenHash: 'ev-2', expiresAt });
  await recordWebEvent(app, alice, gone, { kind: 'message', text: 'y' });
  await owner
    .updateTable('sessions')
    .set({ expires_at: new Date(0) })
    .where('id', '=', gone)
    .execute();
  // Any new session sweeps the expired ones, with their events.
  await createSession(app, alice, { tokenHash: 'ev-3', expiresAt });
  expect(await webEventsAfter(app, alice, gone, '0')).toEqual([]);
});

it('keeps only the newest events of a session', async () => {
  const { app, alice } = ctx;
  for (let n = 0; n < WEB_EVENT_KEEP + 5; n += 1) {
    await recordWebEvent(app, alice, 's-cap', { kind: 'message', text: String(n) });
  }
  const kept = await webEventsAfter(app, alice, 's-cap', '0');
  expect(kept).toHaveLength(WEB_EVENT_PAGE);
  const all = await ctx.owner
    .selectFrom('web_events')
    .select('text')
    .where('chat_id', '=', 's-cap')
    .execute();
  expect(all).toHaveLength(WEB_EVENT_KEEP);
  expect(all.some((row) => row.text === '0')).toBe(false);
}, 60_000);
