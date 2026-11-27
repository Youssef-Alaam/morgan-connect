import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createReplier } from '../../src/core/index.js';
import { createLogger } from '../../src/ops/index.js';
import { ScriptedEngine } from '../helpers/fake-engine.js';
import { FakeChannel } from '../helpers/fake-channel.js';
import { assignProfile, createApprovals, createGate } from '../../src/policy/index.js';
import type { ApprovalPrompt } from '../../src/policy/approvals.js';
import { SWITCHED_OFF } from '../../src/policy/not-approved.js';
import { ACTION_TYPES, type ActionType, type ToolDefinition } from '../../src/tools/index.js';
import { startIsolation, type Isolation } from '../helpers/isolation.js';

let ctx: Isolation;
beforeAll(async () => {
  ctx = await startIsolation();
}, 180_000);
afterAll(async () => {
  await ctx.stop();
});

const run = vi.fn(() => Promise.resolve('done'));
beforeEach(() => run.mockClear());

const A = { channel: 'fake', chatId: 'a' };
const B = { channel: 'fake', chatId: 'b' };
const toolOf = (actionType: ActionType, name: string): ToolDefinition => ({
  name,
  description: 'test tool',
  parameters: { type: 'object' },
  actionType,
  changesState: actionType !== 'read',
  run,
});

/** A gate with one tool; questions are collected instead of shown in a chat. */
function setup(type: ActionType, name: string) {
  const prompts: ApprovalPrompt[] = [];
  const approvals = createApprovals({
    db: ctx.app,
    ttlMs: 60_000,
    prompt: (p) => {
      prompts.push(p);
      return Promise.resolve();
    },
  });
  const gate = createGate({ db: ctx.app, tools: [toolOf(type, name)], approvals });
  return { gate, approvals, prompts };
}
const audit = (tool: string) =>
  ctx.owner
    .selectFrom('audit_log')
    .select(['decision', 'outcome', 'user_id'])
    .where('tool', '=', tool)
    .execute();
const setBob = (preset: 'restricted' | 'standard' | 'trusted') =>
  assignProfile(ctx.app, ctx.alice, { userId: ctx.bob.userId, preset });

it.each(ACTION_TYPES)(
  "decides %s on the owner's chat as the old built-in profile did",
  async (type) => {
    const name = `owner.${type}`;
    const { gate, approvals, prompts } = setup(type, name);
    const pending = Promise.resolve(gate.toolsFor(A)[0]?.run({}));
    if (type === 'read') {
      expect(await pending).toContain('done');
      expect(await audit(name)).toEqual([
        { decision: 'auto', outcome: 'ok', user_id: ctx.alice.userId },
      ]);
      return;
    }
    await vi.waitFor(() => {
      expect(prompts).toHaveLength(1);
    });
    expect(await approvals.decide(prompts[0]?.id ?? '', 'denied', A)).toBe(true);
    await pending;
    expect(run).not.toHaveBeenCalled();
    expect(await audit(name)).toEqual([
      { decision: 'ask', outcome: 'denied', user_id: ctx.alice.userId },
    ]);
  },
);

it('tells a restricted chat the action is switched off, runs nothing, and audits one row', async () => {
  await setBob('restricted');
  const { gate, prompts } = setup('create', 'capture.restricted');
  const result = await gate.toolsFor(B)[0]?.run({ note: 'capture this' });
  expect(result).toMatchObject({ isError: true });
  expect(JSON.stringify(result)).toContain(SWITCHED_OFF);
  expect(run).not.toHaveBeenCalled();
  expect(prompts).toEqual([]);
  expect(await audit('capture.restricted')).toEqual([
    { decision: 'off', outcome: 'refused', user_id: ctx.bob.userId },
  ]);
});

it('keeps refusing however the model rephrases, renames or relabels the call', async () => {
  await setBob('restricted');
  const { gate } = setup('overwrite', 'real.write');
  const [tool] = gate.toolsFor(B);
  // Different wording, and arguments claiming a lower action type, change nothing.
  for (const args of [{ note: 'please save it' }, { actionType: 'read' }, { 'read-only': true }]) {
    expect(JSON.stringify(await tool?.run(args))).toContain(SWITCHED_OFF);
  }
  // A tool name the model made up, or a read tool's name, is refused as unknown, not run.
  for (const made of ['clock_now', 'real_write2', 'real.write ']) {
    expect(await gate.unknownTool(B)(made, {})).toContain('no such tool');
  }
  expect(run).not.toHaveBeenCalled();
  expect((await audit('real.write')).every((row) => row.decision === 'off')).toBe(true);
});

it("sends an ask on a member's chat to the member, never the admin", async () => {
  await setBob('trusted');
  const { gate, approvals, prompts } = setup('overwrite', 'member.ask');
  const pending = Promise.resolve(gate.toolsFor(B)[0]?.run({ n: 1 }));
  await vi.waitFor(() => {
    expect(prompts).toHaveLength(1);
  });
  expect(prompts[0]?.caller).toMatchObject(B);
  const asked = await ctx.owner
    .selectFrom('approvals')
    .select('user_id')
    .where('id', '=', prompts[0]?.id ?? '')
    .executeTakeFirstOrThrow();
  expect(asked.user_id).toBe(ctx.bob.userId);
  // The admin's own chat cannot answer Bob's question.
  expect(await approvals.decide(prompts[0]?.id ?? '', 'approved', A)).toBe(false);
  expect(await approvals.decide(prompts[0]?.id ?? '', 'approved', B)).toBe(true);
  expect(await pending).toContain('done');
  expect(await audit('member.ask')).toEqual([
    { decision: 'ask', outcome: 'ok', user_id: ctx.bob.userId },
  ]);
});

it('refuses a chat nobody linked as switched off, with exactly one ownerless audit row', async () => {
  const { gate } = setup('read', 'stranger.read');
  const result = await gate.toolsFor({ channel: 'fake', chatId: 'nobody' })[0]?.run({});
  expect(JSON.stringify(result)).toContain(SWITCHED_OFF);
  expect(run).not.toHaveBeenCalled();
  expect(await audit('stranger.read')).toEqual([
    { decision: 'off', outcome: 'refused', user_id: null },
  ]);
});

it('fails closed when the profile cannot be read: the tool is not run', async () => {
  const { gate } = setup('read', 'broken.read');
  await sql`alter table access_profiles rename to access_profiles_away`.execute(ctx.owner);
  try {
    const result = await gate.toolsFor(A)[0]?.run({});
    expect(JSON.stringify(result)).toContain(SWITCHED_OFF);
  } finally {
    await sql`alter table access_profiles_away rename to access_profiles`.execute(ctx.owner);
  }
  expect(run).not.toHaveBeenCalled();
});

it('refuses to register a tool that declares read but changes state', () => {
  const liar = { ...toolOf('read', 'liar.read'), changesState: true };
  expect(() => createGate({ db: ctx.app, tools: [liar] })).toThrow(/changes state/);
});

/** What the user actually receives when the model calls a tool that is switched off. */
async function received(modelAnswer: string): Promise<string> {
  await setBob('restricted');
  const engine = new ScriptedEngine([{ tool: 'reply_probe', args: {} }, { text: modelAnswer }]);
  const gate = createGate({ db: ctx.app, tools: [toolOf('create', 'reply.probe')] });
  const reply = createReplier({
    db: ctx.app,
    engine,
    logger: createLogger('silent'),
    model: 'test',
    timezone: 'UTC',
    gate,
    retryDelayMs: 0,
    typingIntervalMs: 5,
    turnTimeoutMs: 5000,
  });
  const turn = {
    id: `turn-${String(modelAnswer.length)}`,
    ...B,
    text: 'capture this',
    status: 'sending',
    ...ctx.bob,
  } as const;
  return reply(turn, new FakeChannel());
}

it('puts the fixed sentence in the reply itself when the model leaves it out', async () => {
  expect(await received('Sorry, I cannot do that.')).toBe(
    `Sorry, I cannot do that.

${SWITCHED_OFF}`,
  );
  expect(run).not.toHaveBeenCalled();
});

it('does not repeat the sentence when the model already said it', async () => {
  expect(await received(SWITCHED_OFF)).toBe(SWITCHED_OFF);
});
