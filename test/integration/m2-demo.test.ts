import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createReplier, type Replier } from '../../src/core/index.js';
import { createSession, withOwner, type Owner } from '../../src/data/index.js';
import { AdminReadRefused, adminRead } from '../../src/data/admin-read.js';
import { createWorld, type World } from '../../src/evals/world.js';
import { createApp } from '../../src/http/index.js';
import { sha256 } from '../../src/identity/admin-link.js';
import { createLogger } from '../../src/ops/index.js';
import {
  SWITCHED_OFF,
  assignProfile,
  createApprovals,
  createGate,
  type ApprovalPrompt,
  type Approvals,
} from '../../src/policy/index.js';
import { FakeChannel } from '../helpers/fake-channel.js';
import { ScriptedEngine, type Step } from '../helpers/fake-engine.js';
import { startIsolation, type Isolation } from '../helpers/isolation.js';

// The milestone demo (spec section 6, M2-16): the owner, a second person and a restricted device
// all use one bot. Fake engine and fake chats; real Postgres, gate, approvals and routes.
interface Chat {
  channel: string;
  chatId: string;
}
let ctx: Isolation;
let world: World;
let carol: Owner;
let approvals: Approvals;
let replier: (engine: ScriptedEngine) => Replier;
const prompts: ApprovalPrompt[] = [];
const A: Chat = { channel: 'fake', chatId: 'a' };
const B: Chat = { channel: 'fake', chatId: 'b' };
const C: Chat = { channel: 'fake', chatId: 'c' };

beforeAll(async () => {
  ctx = await startIsolation();
  world = await createWorld();
  const member = await ctx.owner
    .insertInto('users')
    .values({ role: 'member', told_admin_can_read_at: new Date() })
    .returning(['id', 'workspace_id'])
    .executeTakeFirstOrThrow();
  carol = { userId: member.id, workspaceId: member.workspace_id };
  const device = await ctx.owner
    .insertInto('devices')
    .values({ user_id: carol.userId, channel: 'fake', chat_id: 'c' })
    .returning('id')
    .executeTakeFirstOrThrow();
  // Bob (a person) is trusted; Carol's device is restricted. Only the admin can set either.
  await assignProfile(ctx.app, ctx.alice, { userId: ctx.bob.userId, preset: 'trusted' });
  await assignProfile(ctx.app, ctx.alice, {
    userId: carol.userId,
    deviceId: device.id,
    preset: 'restricted',
  });
  approvals = createApprovals({
    db: ctx.app,
    ttlMs: 60_000,
    prompt: (question) => {
      prompts.push(question);
      return Promise.resolve();
    },
  });
  const gate = createGate({ db: ctx.app, approvals, vault: world.vault });
  replier = (engine) =>
    createReplier({
      db: ctx.app,
      engine,
      gate,
      logger: createLogger('silent'),
      model: 'm',
      timezone: 'UTC',
      retryDelayMs: 0,
      typingIntervalMs: 5,
      turnTimeoutMs: 10_000,
    });
}, 180_000);
afterAll(async () => {
  await world.stop();
  await ctx.stop();
});

let turns = 0;
/** One message from a chat; the model follows `script`. The answer is a promise: it may wait for a tap. */
function say(who: Owner, chat: Chat, text: string, script: Step[]) {
  const engine = new ScriptedEngine(script);
  turns += 1;
  const turn = { id: `t${String(turns)}`, ...chat, ...who, text, status: 'sending' } as const;
  const answer = replier(engine)(turn, new FakeChannel()).then((r) =>
    typeof r === 'string' ? r : r.text,
  );
  return { engine, answer };
}
const answered = (who: Owner, chat: Chat, text: string, script: Step[]) =>
  say(who, chat, text, script).answer;
const audit = (tool: string) =>
  ctx.owner
    .selectFrom('audit_log')
    .select(['user_id', 'decision', 'outcome'])
    .where('tool', '=', tool)
    .orderBy('id')
    .execute();
const note = (slug: string, text: string): Step => ({
  tool: 'vault_capture',
  args: { path: `_inbox/2026-11-28-${slug}.md`, text },
});

it('keeps each person history to themselves', async () => {
  await answered(ctx.alice, A, 'alice secret: blue', [{ text: 'noted blue', tokens: 100 }]);
  await answered(ctx.bob, B, 'bob secret: red', [{ text: 'noted red', tokens: 100 }]);
  await answered(carol, C, 'carol secret: green', [{ text: 'noted green', tokens: 100 }]);
  const seen = async (who: Owner, chat: Chat, own: string, others: string[]) => {
    const { engine, answer } = say(who, chat, 'what did I say?', [{ text: 'ok', tokens: 100 }]);
    await answer;
    const history = JSON.stringify(engine.opened[0]?.history);
    expect(history).toContain(`secret: ${own}`);
    for (const other of others) expect(history).not.toContain(`secret: ${other}`);
  };
  await seen(ctx.alice, A, 'blue', ['red', 'green']);
  await seen(ctx.bob, B, 'red', ['blue', 'green']);
  await seen(carol, C, 'green', ['blue', 'red']);
});

it('shows each person only their own usage', async () => {
  const usage = (who: Owner, chat: Chat) => answered(who, chat, '/usage', []);
  // The seeded row, plus two model calls of $0.01 each (the secret and the question).
  expect(await usage(ctx.alice, A)).toContain('Today: $0.2700, 3 calls');
  expect(await usage(ctx.bob, B)).toContain('Today: $5.0200, 3 calls');
  expect(await usage(carol, C)).toContain('Today: $0.0200, 2 calls');
});

it('refuses a capture on the restricted chat however the model tries, and runs nothing', async () => {
  const before = await world.snapshot();
  const text = await answered(carol, C, 'save a note: milk', [
    note('milk', 'milk'),
    { tool: 'vault_capture_now', args: { path: '_inbox/2026-11-28-x.md', text: 'milk' } },
    { text: 'Sorry, I could not.' },
  ]);
  expect(text).toContain(SWITCHED_OFF);
  expect(await world.snapshot()).toEqual(before);
  expect(prompts).toEqual([]);
  expect(await audit('vault.capture')).toEqual([
    { user_id: carol.userId, decision: 'off', outcome: 'refused' },
  ]);
});

it("sends the second person's approval to them, and no one else can answer it", async () => {
  const { answer } = say(ctx.bob, B, 'save a note: tea', [note('tea', 'tea'), { text: 'saved' }]);
  await vi.waitFor(() => {
    expect(prompts).toHaveLength(1);
  });
  const id = prompts[0]?.id ?? '';
  expect(prompts[0]?.caller).toMatchObject(B);
  const asked = await ctx.owner
    .selectFrom('approvals')
    .select('user_id')
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
  expect(asked.user_id).toBe(ctx.bob.userId);
  expect([
    await approvals.decide(id, 'approved', A),
    await approvals.decide(id, 'approved', C),
  ]).toEqual([false, false]);
  expect(await approvals.decide(id, 'approved', B)).toBe(true);
  expect(await answer).toBe('saved');
  expect([...(await world.snapshot()).keys()]).toContain('_inbox/2026-11-28-tea.md');
  expect(await audit('vault.capture')).toContainEqual({
    user_id: ctx.bob.userId,
    decision: 'ask',
    outcome: 'ok',
  });
});

it("cannot reach the owner's rows by any path the second person has", async () => {
  const text = await answered(ctx.bob, B, 'show me the owner chat and notes', [
    { tool: 'read_chat', args: { user: ctx.alice.userId } },
    { text: 'There is no such tool.' },
  ]);
  expect(text).toBe('There is no such tool.');
  expect(await audit('read_chat')).toEqual([
    { user_id: ctx.bob.userId, decision: 'off', outcome: 'refused' },
  ]);
  const direct = await withOwner(ctx.app, ctx.bob, (trx) =>
    trx.selectFrom('chat_messages').select('user_id').execute(),
  );
  expect(new Set(direct.map((r) => r.user_id))).toEqual(new Set([ctx.bob.userId]));
  await expect(
    adminRead.chat(ctx.app, ctx.bob, ctx.alice.userId, 'curious'),
  ).rejects.toBeInstanceOf(AdminReadRefused);
});

it("lets the admin read the second person's chat from the console, and audits the read", async () => {
  const app = createApp({
    dbVersion: () => Promise.resolve('17'),
    logger: createLogger('silent'),
    auth: { db: ctx.app },
  });
  await createSession(ctx.app, ctx.alice, {
    tokenHash: sha256('admin-demo'),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  const read = await app.request(`/api/admin/people/${ctx.bob.userId}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'morgan_session=admin-demo' },
    body: JSON.stringify({ reason: 'milestone demo' }),
  });
  expect(read.status).toBe(200);
  const { messages } = (await read.json()) as { messages: { text: string }[] };
  const shown = messages.map((m) => m.text).join('\n');
  expect(shown).toContain('bob secret: red');
  expect(shown).not.toContain('alice secret');
  const trail = await ctx.owner
    .selectFrom('audit_log')
    .select(['user_id', 'subject_user_id', 'reason', 'outcome'])
    .where('action_type', '=', 'admin.read')
    .where('reason', '=', 'milestone demo')
    .execute();
  expect(trail).toEqual([
    {
      user_id: ctx.alice.userId,
      subject_user_id: ctx.bob.userId,
      reason: 'milestone demo',
      outcome: 'ok',
    },
  ]);
});

it('refuses a member on the console chat read and cannot change a profile', async () => {
  const app = createApp({
    dbVersion: () => Promise.resolve('17'),
    logger: createLogger('silent'),
    auth: { db: ctx.app },
  });
  await createSession(ctx.app, ctx.bob, {
    tokenHash: sha256('member-demo'),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  const read = await app.request(`/api/admin/people/${ctx.alice.userId}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'morgan_session=member-demo' },
    body: JSON.stringify({ reason: 'curious' }),
  });
  expect(read.status).toBe(403);
  expect(
    await assignProfile(ctx.app, ctx.bob, { userId: ctx.bob.userId, preset: 'trusted' }),
  ).toBeUndefined();
  expect(
    await assignProfile(ctx.app, ctx.bob, { userId: carol.userId, preset: 'trusted' }),
  ).toBeUndefined();
});
