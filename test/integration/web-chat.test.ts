import { afterAll, beforeAll, expect, it } from 'vitest';
import { createWebChannel } from '../../src/channels/index.js';
import { ingest, processTurn, type PipelineDeps } from '../../src/core/index.js';
import { createSession, endSession, type TurnQueue } from '../../src/data/index.js';
import { createApp, type ChatDeps } from '../../src/http/index.js';
import { sha256 } from '../../src/identity/admin-link.js';
import { createIdentity } from '../../src/identity/index.js';
import { createLogger } from '../../src/ops/index.js';
import { startIsolation, type Isolation } from '../helpers/isolation.js';
import { readEvents } from '../helpers/sse.js';

let ctx: Isolation;
let app: ReturnType<typeof createApp>;
const cookies = { alice: 'morgan_session=alice-token', bob: 'morgan_session=bob-token' };

beforeAll(async () => {
  ctx = await startIsolation();
  const expiresAt = new Date(Date.now() + 3_600_000);
  await createSession(ctx.app, ctx.alice, { tokenHash: sha256('alice-token'), expiresAt });
  await createSession(ctx.app, ctx.bob, { tokenHash: sha256('bob-token'), expiresAt });
  const logger = createLogger('silent');
  const web = createWebChannel(ctx.app);
  const queue: TurnQueue = {
    expireInSeconds: 300,
    start: () => Promise.resolve(),
    enqueue: (id) => {
      setImmediate(() => void processTurn(deps, id));
      return Promise.resolve();
    },
    work: () => Promise.resolve(),
    stop: () => Promise.resolve(),
  };
  const deps: PipelineDeps = {
    db: ctx.app,
    queue,
    senders: [web],
    logger,
    retryDelayMs: 1,
    identity: createIdentity(ctx.app),
  };
  app = appWith({
    events: web,
    ingest: (message) => ingest(deps, message),
    decide: () => Promise.resolve(false),
  });
}, 180_000);
afterAll(async () => {
  await ctx.stop();
});

const appWith = (chat: Omit<ChatDeps, 'logger' | 'db'>) =>
  createApp({
    dbVersion: () => Promise.resolve('17'),
    logger: createLogger('silent'),
    auth: { db: ctx.app },
    chat,
  });
const send = (who: keyof typeof cookies, body: unknown, type = 'application/json') =>
  app.request('/api/chat', {
    method: 'POST',
    headers: { 'content-type': type, cookie: cookies[who] },
    body: JSON.stringify(body),
  });
const events = (who: keyof typeof cookies, headers: Record<string, string> = {}) =>
  app.request('/api/chat/events', { headers: { cookie: cookies[who], ...headers } });

it('refuses a form post and a bad body', async () => {
  expect((await send('alice', { text: 'x' }, 'text/plain')).status).toBe(415);
  expect((await send('alice', { text: '' })).status).toBe(400);
  expect((await send('alice', 'nope')).status).toBe(400);
});

it('puts every chat route behind the session gate, and a temporary password gets a 403', async () => {
  const routes = app.routes.filter((r) => r.path.startsWith('/api/chat') && r.method !== 'ALL');
  expect(routes).toHaveLength(3);
  const call = (method: string, path: string, cookie: string) =>
    app.request(path, {
      method,
      headers: { 'content-type': 'application/json', cookie },
      ...(method === 'GET' ? {} : { body: JSON.stringify({ text: 'x', messageId: 'tmp' }) }),
    });
  const set = (mustChange: boolean) =>
    ctx.owner.updateTable('credentials').set({ must_change: mustChange }).execute();
  await set(true);
  try {
    for (const { method, path } of routes) {
      expect([path, (await call(method, path, '')).status]).toEqual([path, 401]);
      expect([path, (await call(method, path, cookies.bob)).status]).toEqual([path, 403]);
    }
  } finally {
    await set(false);
  }
});

it('acknowledges a message and streams its reply, in order', async () => {
  const stream = await events('alice');
  const sent = await send('alice', { text: 'hello', messageId: 'm1' });
  expect(sent.status).toBe(202);
  const [ack, reply] = await readEvents(stream, 2);
  expect([ack?.event, ack?.data.ref]).toEqual(['ack', 'm1']);
  expect([reply?.event, reply?.data.text]).toEqual(['message', 'hello']);
  expect(BigInt(reply?.id ?? '0')).toBeGreaterThan(BigInt(ack?.id ?? '0'));
});

it('resumes after the last id seen, with nothing repeated', async () => {
  await send('alice', { text: 'second', messageId: 'm2' });
  const all = await readEvents(await events('alice'), 4);
  expect(all.map((e) => e.data.text || e.data.ref)).toEqual(['m1', 'hello', 'm2', 'second']);
  const rest = await readEvents(await events('alice', { 'last-event-id': all[1]?.id ?? '' }), 2);
  expect(rest.map((e) => e.id)).toEqual(all.slice(2).map((e) => e.id));
});

it('never shows one person the events of another', async () => {
  const bobsStream = await events('bob');
  await send('bob', { text: 'bob secret', messageId: 'b1' });
  await send('alice', { text: 'alice secret', messageId: 'a3' });
  const seen = await readEvents(bobsStream, 2);
  expect(seen.map((e) => e.data.text || e.data.ref)).toEqual(['b1', 'bob secret']);
  // Aiming at the other session by any parameter changes nothing: the session is the cookie's.
  const forged = await readEvents(await events('bob', { 'last-event-id': '0' }), 2);
  expect(JSON.stringify(forged)).not.toMatch(/alice|a3|hello|m1|m2|second/);
  const alices = await readEvents(await events('alice'), 6);
  expect(JSON.stringify(alices)).not.toMatch(/bob|b1/);
});

it('turns a resent message into one acknowledgement and one reply', async () => {
  const body = { text: 'once only', messageId: 'dup' };
  expect((await send('alice', body)).status).toBe(202);
  expect((await send('alice', body)).status).toBe(202);
  const stored = async () => {
    const rows = await ctx.owner.selectFrom('web_events').select(['kind', 'ref', 'text']).execute();
    return rows.filter((row) => row.ref === 'dup' || row.text === 'once only');
  };
  await expect.poll(async () => (await stored()).length, { timeout: 10_000 }).toBeGreaterThan(1);
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect((await stored()).map((row) => row.kind)).toEqual(['ack', 'message']);
});

it('keeps a quiet stream alive with a comment line', async () => {
  const quiet = appWith({
    events: createWebChannel(ctx.app),
    ingest: () => Promise.resolve(),
    decide: () => Promise.resolve(false),
    keepAliveMs: 20,
  });
  const response = await quiet.request('/api/chat/events', {
    headers: { cookie: cookies.alice, 'last-event-id': '999999999' },
  });
  const reader = response.body?.getReader();
  const chunk = await reader?.read();
  expect(new TextDecoder().decode(chunk?.value as Uint8Array | undefined)).toContain(
    ': keep-alive',
  );
  await reader?.cancel();
});

it('ends a stream whose read fails with a fixed word, and cannot send to an ended session', async () => {
  const web = createWebChannel(ctx.app);
  const eventsAfter = () => Promise.reject(new Error('database is down'));
  const broken = appWith({
    events: { ...web, eventsAfter },
    ingest: () => Promise.resolve(),
    decide: () => Promise.resolve(false),
  });
  const response = await broken.request('/api/chat/events', { headers: { cookie: cookies.alice } });
  expect(await response.text()).toBe('event: error\ndata: stream_failed\n\n');
  await expect(web.send('no-such-session', 'hi')).rejects.toThrow(/ended/);
});

it('closes a stream at the next keep-alive once its session has ended', async () => {
  const expiresAt = new Date(Date.now() + 3_600_000);
  const id = await createSession(ctx.app, ctx.alice, { tokenHash: sha256('gone'), expiresAt });
  const quiet = appWith({
    events: createWebChannel(ctx.app),
    ingest: () => Promise.resolve(),
    decide: () => Promise.resolve(false),
    keepAliveMs: 20,
  });
  const response = await quiet.request('/api/chat/events', {
    headers: { cookie: 'morgan_session=gone', 'last-event-id': '999999999' },
  });
  await endSession(ctx.app, ctx.alice, id);
  // The body ends by itself; a stream that stayed open would hang this until the test times out.
  expect((await response.text()).replaceAll(': keep-alive\n\n', '')).toBe('');
});
