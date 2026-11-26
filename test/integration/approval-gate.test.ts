import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createReplier, FAILURE_REPLY } from '../../src/core/index.js';
import { createDb, migrateToLatest, type Db, type Owner } from '../../src/data/index.js';
import { createLogger } from '../../src/ops/index.js';
import { createApprovals, type ApprovalPrompt } from '../../src/policy/approvals.js';
import { createGate, type Caller } from '../../src/policy/gate.js';
import type { ToolDefinition } from '../../src/tools/index.js';
import { ScriptedEngine } from '../helpers/fake-engine.js';
import { linkChats } from '../helpers/link-chats.js';
import { startPostgres, type TestPostgres } from '../helpers/postgres.js';

const TTL_MS = 60_000;
const OWNER_CHAT = { channel: 'fake', chatId: 'owner-chat' };
const caller: Caller = { ...OWNER_CHAT, turnId: 'turn-1' };
let postgres: TestPostgres;
let db: Db;
let owner: Owner;
let clock: number;

beforeAll(async () => {
  postgres = await startPostgres();
  db = createDb(postgres.url);
  await migrateToLatest(db);
  owner = await linkChats(db, ['owner-chat']);
}, 180_000);

afterAll(async () => {
  await db.destroy();
  await postgres.stop();
});

beforeEach(async () => {
  clock = Date.parse('2026-11-26T10:00:00Z');
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  await sql`alter table audit_log disable trigger user`.execute(db);
  await sql`truncate audit_log, approvals`.execute(db);
  await sql`alter table audit_log enable trigger user`.execute(db);
});

afterEach(() => {
  vi.useRealTimers();
});

const audit = (): Promise<{ outcome: string; decision: string; tool: string }[]> =>
  db.selectFrom('audit_log').select(['outcome', 'decision', 'tool']).orderBy('id').execute();

/** A gate with one state-changing tool; questions are collected instead of shown in a chat. */
function setup(run: ToolDefinition['run'] = () => Promise.resolve('done')) {
  const listeners: ((prompt: ApprovalPrompt) => void)[] = [];
  const approvals = createApprovals({
    db,
    ttlMs: TTL_MS,
    now: () => new Date(clock),
    prompt: (p) => {
      listeners.shift()?.(p);
      return Promise.resolve();
    },
  });
  const tool: ToolDefinition = {
    name: 'demo.gated',
    description: 'test tool',
    parameters: { type: 'object' },
    actionType: 'overwrite',
    changesState: true,
    run: vi.fn(run),
  };
  const gate = createGate({ db, tools: [tool], approvals });
  const nextPrompt = () => new Promise<ApprovalPrompt>((resolve) => listeners.push(resolve));
  const call = (args: Record<string, unknown>, signal?: AbortSignal, who = caller) => {
    const asked = nextPrompt();
    const result = Promise.resolve(gate.toolsFor(who)[0]?.run(args, signal));
    return { result, asked };
  };
  return { approvals, tool, call, nextPrompt };
}

it('runs the tool once after Approve, and the audit row says ask then ok', async () => {
  const { approvals, tool, call } = setup();
  const { result, asked } = call({ note: 'hi' });
  const prompt = await asked;
  expect(tool.run).not.toHaveBeenCalled();
  await approvals.decide(prompt.id, 'approved', OWNER_CHAT);
  expect(await result).toContain('done');
  expect(tool.run).toHaveBeenCalledTimes(1);
  expect(tool.run).toHaveBeenCalledWith({ note: 'hi' }, expect.anything());
  expect(await audit()).toEqual([{ outcome: 'ok', decision: 'ask', tool: 'demo.gated' }]);
});

it('tells the model it was refused after Deny and never runs the tool', async () => {
  const { approvals, tool, call } = setup();
  const { result, asked } = call({ note: 'x' });
  await approvals.decide((await asked).id, 'denied', OWNER_CHAT);
  expect(await result).toMatchObject({
    isError: true,
    text: expect.stringContaining('said no') as string,
  });
  expect(tool.run).not.toHaveBeenCalled();
  expect(await audit()).toEqual([{ outcome: 'denied', decision: 'ask', tool: 'demo.gated' }]);
});

it('does not run the tool when the question expires', async () => {
  const { tool, call } = setup();
  const { result, asked } = call({ note: 'x' });
  await asked;
  clock += TTL_MS;
  await vi.advanceTimersByTimeAsync(TTL_MS);
  expect(await result).toMatchObject({
    isError: true,
    text: expect.stringContaining('in time') as string,
  });
  expect(tool.run).not.toHaveBeenCalled();
  expect(await audit()).toEqual([{ outcome: 'expired', decision: 'ask', tool: 'demo.gated' }]);
});

it('stops the turn when it is aborted while waiting, and records it', async () => {
  const { tool, call } = setup();
  const stop = new AbortController();
  const { result, asked } = call({ note: 'x' }, stop.signal);
  await asked;
  stop.abort();
  await expect(result).rejects.toMatchObject({ kind: 'aborted' });
  expect(tool.run).not.toHaveBeenCalled();
  expect(await audit()).toEqual([{ outcome: 'aborted', decision: 'ask', tool: 'demo.gated' }]);
});

it('refuses a chat nobody linked as switched off, with one audit row', async () => {
  const { tool, call } = setup();
  const refused = await call({ note: 'x' }, undefined, { channel: 'fake', chatId: 'nobody' })
    .result;
  expect(refused).toMatchObject({
    isError: true,
    text: expect.stringContaining('switched off') as string,
  });
  expect(tool.run).not.toHaveBeenCalled();
  expect(await audit()).toEqual([{ outcome: 'refused', decision: 'off', tool: 'demo.gated' }]);
});

it('refuses and audits an error when the question cannot be put', async () => {
  const { approvals, tool, call } = setup();
  vi.spyOn(approvals, 'request').mockRejectedValue(new Error('database down'));
  expect(await call({ note: 'x' }).result).toMatchObject({
    isError: true,
    text: expect.stringContaining('could not be asked') as string,
  });
  expect(tool.run).not.toHaveBeenCalled();
  expect(await audit()).toEqual([{ outcome: 'error', decision: 'ask', tool: 'demo.gated' }]);
});

it('never retries a state-changing tool that failed, even when the model call then fails', async () => {
  const run = vi.fn(() => Promise.reject(new Error('disk full')));
  const { approvals, nextPrompt, tool } = setup(run);
  const engine = new ScriptedEngine([
    { tool: 'demo_gated', args: { note: 'x' } },
    { error: 'transient' },
    { text: 'unused' },
  ]);
  const reply = createReplier({
    db,
    engine,
    logger: createLogger('silent'),
    model: 'test',
    timezone: 'UTC',
    gate: createGate({ db, tools: [tool], approvals }),
    retryDelayMs: 0,
    typingIntervalMs: 5,
    turnTimeoutMs: 600_000,
  });
  const turn = { id: 'turn-1', ...OWNER_CHAT, text: 'do it', status: 'sending', ...owner } as const;
  const asked = nextPrompt();
  const done = reply(turn, { channel: 'fake', send: () => Promise.resolve() });
  await approvals.decide((await asked).id, 'approved', OWNER_CHAT);
  expect(await done).toBe(FAILURE_REPLY);
  expect(run).toHaveBeenCalledTimes(1);
  expect(engine.opened).toHaveLength(1);
  expect(await audit()).toEqual([{ outcome: 'error', decision: 'ask', tool: 'demo.gated' }]);
});
