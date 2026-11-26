import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createReplier } from '../../src/core/index.js';
import { createDb, migrateToLatest, type Db, type Owner } from '../../src/data/index.js';
import { createLogger } from '../../src/ops/index.js';
import { createGate, type Caller } from '../../src/policy/gate.js';
import { ACTION_TYPES, createClockTool, type ToolDefinition } from '../../src/tools/index.js';
import { FakeChannel } from '../helpers/fake-channel.js';
import { ScriptedEngine } from '../helpers/fake-engine.js';
import { linkChats } from '../helpers/link-chats.js';
import { startPostgres, type TestPostgres } from '../helpers/postgres.js';

const USER = '00000000-0000-0000-0000-0000000000a1';
const caller: Caller = { channel: 'fake', chatId: 'audit-chat', turnId: 'turn-1' };
let postgres: TestPostgres;
let db: Db;
let who: Owner;

beforeAll(async () => {
  postgres = await startPostgres();
  db = createDb(postgres.url);
  await migrateToLatest(db);
  await sql`insert into users (id) values (${USER})`.execute(db);
  await sql`insert into devices (user_id, channel, chat_id) values (${USER}, 'fake', 'audit-chat')`.execute(
    db,
  );
  who = await linkChats(db, []);
}, 180_000);

afterAll(async () => {
  await db.destroy();
  await postgres.stop();
});

/** Tests may clear the log only by switching the append-only triggers off for a moment. */
beforeEach(async () => {
  await sql`alter table audit_log disable trigger user`.execute(db);
  await sql`truncate audit_log`.execute(db);
  await sql`alter table audit_log enable trigger user`.execute(db);
});

const rows = (): Promise<Record<string, unknown>[]> =>
  db.selectFrom('audit_log').selectAll().orderBy('id').execute();

const spy = (
  actionType: ToolDefinition['actionType'],
  run: ToolDefinition['run'] = vi.fn(() => Promise.resolve('done')),
): { tool: ToolDefinition; run: ToolDefinition['run'] } => ({
  tool: {
    name: `spy.${actionType}`,
    description: 'test tool',
    parameters: { type: 'object' },
    actionType,
    changesState: actionType !== 'read',
    run,
  },
  run,
});

it('clock.now through the engine: the answer comes back and the audit row says who and what', async () => {
  const engine = new ScriptedEngine([
    { tool: 'clock_now', args: { timezone: 'Asia/Riyadh' } },
    { text: 'It is late.' },
  ]);
  const reply = createReplier({
    db,
    engine,
    logger: createLogger('silent'),
    model: 'test',
    timezone: 'UTC',
    gate: createGate({ db }),
    retryDelayMs: 0,
    typingIntervalMs: 5,
    turnTimeoutMs: 5000,
  });
  const turn = {
    id: 'turn-1',
    channel: 'fake',
    chatId: 'audit-chat',
    text: 'time?',
    status: 'sending',
    ...who,
  } as const;
  expect(await reply(turn, new FakeChannel())).toBe('It is late.');
  expect(engine.opened[0]?.tools.map((t) => t.name)).toEqual(['clock_now']);
  expect(await rows()).toMatchObject([
    {
      turn_id: 'turn-1',
      channel: 'fake',
      chat_id: 'audit-chat',
      user_id: USER,
      tool: 'clock.now',
      action_type: 'read',
      changes_state: false,
      arg_names: ['timezone'],
      decision: 'auto',
      outcome: 'ok',
    },
  ]);
});

it('every action type writes one audit row and runs only when the profile says auto', async () => {
  const spies = ACTION_TYPES.map((type) => spy(type));
  const tools = createGate({ db, tools: spies.map((s) => s.tool) }).toolsFor(caller);
  for (const tool of tools) await tool.run({});
  const logged = await rows();
  expect(logged.map((r) => [r['action_type'], r['decision'], r['outcome']])).toEqual(
    ACTION_TYPES.map((t) => [t, t === 'read' ? 'auto' : 'ask', t === 'read' ? 'ok' : 'refused']),
  );
  expect(spies.map((s) => vi.mocked(s.run).mock.calls.length)).toEqual(
    ACTION_TYPES.map((t) => (t === 'read' ? 1 : 0)),
  );
});

it('a refused ask tells the model plainly, and a turned-off tool is refused too', async () => {
  const { tool, run } = spy('overwrite');
  const asked = createGate({ db, tools: [tool] }).toolsFor(caller)[0];
  const refusal = await asked?.run({});
  expect(refusal).toMatchObject({ isError: true });
  expect(JSON.stringify(refusal)).toContain('approve');
  const off = createGate({
    db,
    tools: [tool],
    profile: {
      read: 'off',
      create: 'off',
      overwrite: 'off',
      delete: 'off',
      send: 'off',
      execute: 'off',
    },
  }).toolsFor(caller)[0];
  const refused = await off?.run({});
  expect(refused).toMatchObject({ isError: true });
  expect(JSON.stringify(refused)).toContain('turned off');
  expect(run).not.toHaveBeenCalled();
  expect((await rows()).map((r) => [r['decision'], r['outcome']])).toEqual([
    ['ask', 'refused'],
    ['off', 'refused'],
  ]);
});

it('a failing tool is logged once as an error, with no values, and the failure goes on', async () => {
  const boom = spy(
    'read',
    vi.fn(() => Promise.reject(new Error('secret-token-123'))),
  );
  const tool = createGate({ db, tools: [boom.tool] }).toolsFor(caller)[0];
  await expect(tool?.run({ note: 'private text' })).rejects.toThrow('secret-token-123');
  const logged = await rows();
  expect(logged).toHaveLength(1);
  expect(logged[0]).toMatchObject({ outcome: 'error', arg_names: [], extra_args: 1 });
  expect(JSON.stringify(logged)).not.toContain('secret-token-123');
  expect(JSON.stringify(logged)).not.toContain('private text');
});

it('records no user for a chat that is not linked', async () => {
  const gate = createGate({ db, tools: [createClockTool()] });
  await gate.toolsFor({ channel: 'fake', chatId: 'nobody' })[0]?.run({});
  expect((await rows())[0]).toMatchObject({ user_id: null, turn_id: null });
});
