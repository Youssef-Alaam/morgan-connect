import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createWebChannel } from '../../src/channels/index.js';
import { createReplier } from '../../src/core/index.js';
import { createSession } from '../../src/data/index.js';
import { createApp } from '../../src/http/index.js';
import { sha256 } from '../../src/identity/admin-link.js';
import { createLogger } from '../../src/ops/index.js';
import {
  approvalHash,
  assignProfile,
  createApprovals,
  createGate,
  SWITCHED_OFF,
} from '../../src/policy/index.js';
import type { ToolDefinition } from '../../src/tools/index.js';
import { ScriptedEngine } from '../helpers/fake-engine.js';
import { startIsolation, type Isolation } from '../helpers/isolation.js';
import { readEvents } from '../helpers/sse.js';

let ctx: Isolation;
let app: ReturnType<typeof createApp>;
let web: ReturnType<typeof createWebChannel>;
let approvals: ReturnType<typeof createApprovals>;
const sessions = { alice: '', bob: '' };
const cookies = {
  alice: 'morgan_session=alice-token',
  bob: 'morgan_session=bob-token',
  aliceTablet: 'morgan_session=alice-tablet-token',
};
const run = vi.fn<ToolDefinition['run']>(() => Promise.resolve('done'));
const tool: ToolDefinition = {
  name: 'notes.create',
  description: 'test tool',
  parameters: { type: 'object' },
  actionType: 'create',
  changesState: true,
  run,
};

beforeAll(async () => {
  ctx = await startIsolation();
  const expiresAt = new Date(Date.now() + 3_600_000);
  sessions.alice = await createSession(ctx.app, ctx.alice, {
    tokenHash: sha256('alice-token'),
    expiresAt,
  });
  sessions.bob = await createSession(ctx.app, ctx.bob, {
    tokenHash: sha256('bob-token'),
    expiresAt,
  });
  await createSession(ctx.app, ctx.alice, { tokenHash: sha256('alice-tablet-token'), expiresAt });
  web = createWebChannel(ctx.app);
  approvals = createApprovals({
    db: ctx.app,
    ttlMs: 60_000,
    prompt: ({ caller, text, id }) => web.askApproval(caller.chatId, text, id),
  });
  app = createApp({
    dbVersion: () => Promise.resolve('17'),
    logger: createLogger('silent'),
    auth: { db: ctx.app },
    chat: {
      events: web,
      ingest: () => Promise.resolve(),
      decide: (id, decision, from) => approvals.decide(id, decision, from),
    },
  });
}, 180_000);
afterAll(async () => {
  await ctx.stop();
});

const answer = (who: keyof typeof cookies, id: string, decision: unknown) =>
  app.request(`/api/chat/approvals/${id}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookies[who] },
    body: JSON.stringify({ decision }),
  });
const stream = (who: keyof typeof cookies, lastId = '0') =>
  app.request('/api/chat/events', { headers: { cookie: cookies[who], 'last-event-id': lastId } });
const args = { title: 'Pay the plumber', amount: 40 };

/** Alice's turn calls a gated tool on her web session; resolves with the question as the stream shows it. */
async function ask(source = approvals) {
  const gate = createGate({ db: ctx.app, tools: [tool], approvals: source });
  const caller = { channel: 'web', chatId: sessions.alice };
  const before = await ctx.owner
    .selectFrom('web_events')
    .select((eb) => eb.fn.max('id').as('last'))
    .executeTakeFirst();
  const pending = Promise.resolve(gate.toolsFor(caller)[0]?.run(args));
  await vi.waitFor(async () => {
    const open = await ctx.owner
      .selectFrom('web_events')
      .select('id')
      .where('kind', '=', 'approval')
      .where('id', '>', before?.last ?? '0')
      .execute();
    expect(open).toHaveLength(1);
  });
  const [question] = await readEvents(await stream('alice', before?.last ?? '0'), 1);
  return { pending, question };
}

it('shows the exact arguments, and the approval runs the tool once on exactly those', async () => {
  run.mockClear();
  const { pending, question } = await ask();
  expect(question?.event).toBe('approval');
  expect(question?.data.text).toContain(JSON.stringify(args, null, 2));
  const id = question?.data.ref ?? '';
  const stored = await ctx.owner
    .selectFrom('approvals')
    .select(['args_sha256', 'status', 'chat_id'])
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
  expect(stored).toEqual({
    args_sha256: approvalHash(tool.name, args),
    status: 'pending',
    chat_id: sessions.alice,
  });
  expect((await answer('alice', id, 'approved')).status).toBe(200);
  expect(await pending).toContain('done');
  expect(run).toHaveBeenCalledTimes(1);
  expect(run.mock.calls[0]?.[0]).toEqual(args);
  // Spent: a second tap, or a replay, finds nothing open.
  expect((await answer('alice', id, 'approved')).status).toBe(409);
  expect(run).toHaveBeenCalledTimes(1);
});

it("refuses another person's session, which can neither approve nor deny", async () => {
  run.mockClear();
  const { pending, question } = await ask();
  const id = question?.data.ref ?? '';
  expect((await answer('bob', id, 'approved')).status).toBe(409);
  expect((await answer('bob', id, 'denied')).status).toBe(409);
  const row = await ctx.owner
    .selectFrom('approvals')
    .select('status')
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
  expect(row.status).toBe('pending');
  expect(run).not.toHaveBeenCalled();
  expect((await answer('alice', id, 'denied')).status).toBe(200);
  expect(JSON.stringify(await pending)).toContain('The owner said no');
  expect(run).not.toHaveBeenCalled();
});

it('refuses a bad body, a bad id and a form post, and an unknown question stays unanswered', async () => {
  const id = '00000000-0000-4000-8000-000000000000';
  expect((await answer('alice', id, 'maybe')).status).toBe(400);
  expect((await answer('alice', 'not-an-id', 'approved')).status).toBe(400);
  const form = await app.request(`/api/chat/approvals/${id}`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain', cookie: cookies.alice },
    body: JSON.stringify({ decision: 'approved' }),
  });
  expect(form.status).toBe(415);
  expect((await answer('alice', id, 'approved')).status).toBe(409);
});

it('cannot send a question to a session that has ended', async () => {
  await expect(web.askApproval('no-such-session', 'q', 'id')).rejects.toThrow(/ended/);
});

it('tells a switched-off web chat the same sentence it gets on Telegram', async () => {
  await assignProfile(ctx.app, ctx.alice, { userId: ctx.bob.userId, preset: 'restricted' });
  const engine = new ScriptedEngine([
    { tool: 'notes_create', args: {} },
    { text: 'Sorry, I cannot do that.' },
  ]);
  const reply = createReplier({
    db: ctx.app,
    engine,
    logger: createLogger('silent'),
    model: 'test',
    timezone: 'UTC',
    gate: createGate({ db: ctx.app, tools: [tool], approvals }),
    retryDelayMs: 0,
    typingIntervalMs: 5,
    turnTimeoutMs: 5000,
  });
  const turn = {
    id: 'web-off-turn',
    channel: 'web',
    chatId: sessions.bob,
    text: 'do it',
    status: 'sending',
    ...ctx.bob,
  } as const;
  const told = await reply(turn, web);
  await web.send(sessions.bob, typeof told === 'string' ? told : told.text);
  const [shown] = await readEvents(await stream('bob'), 1);
  expect(shown?.data.text).toContain(SWITCHED_OFF);
});

it("refuses the same person's other session: a question belongs to the one it was shown on", async () => {
  run.mockClear();
  const { pending, question } = await ask();
  const id = question?.data.ref ?? '';
  expect((await answer('aliceTablet', id, 'approved')).status).toBe(409);
  expect(run).not.toHaveBeenCalled();
  expect((await answer('alice', id, 'approved')).status).toBe(200);
  await pending;
  expect(run).toHaveBeenCalledTimes(1);
});

it('cannot answer a replayed question once it has expired', async () => {
  run.mockClear();
  const quick = createApprovals({
    db: ctx.app,
    ttlMs: 150,
    prompt: ({ caller, text, id }) => web.askApproval(caller.chatId, text, id),
  });
  const { pending, question } = await ask(quick);
  expect(JSON.stringify(await pending)).not.toContain('done');
  // A browser that reconnects from the start is shown the old question again.
  const stored = await ctx.owner
    .selectFrom('web_events')
    .select('id')
    .where('chat_id', '=', sessions.alice)
    .execute();
  const replay = await readEvents(await stream('alice'), stored.length);
  expect(replay.map((event) => event.data.ref)).toContain(question?.data.ref);
  const id = question?.data.ref ?? '';
  expect((await answer('alice', id, 'approved')).status).toBe(409);
  expect(run).not.toHaveBeenCalled();
});
