import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createReplier } from '../../src/core/index.js';
import { createDb, migrateToLatest, type Db } from '../../src/data/index.js';
import { createLogger } from '../../src/ops/index.js';
import { createGate, type Caller } from '../../src/policy/gate.js';
import { createClockTool, type ToolDefinition } from '../../src/tools/index.js';
import { FakeChannel } from '../helpers/fake-channel.js';
import { ScriptedEngine } from '../helpers/fake-engine.js';
import { startPostgres, type TestPostgres } from '../helpers/postgres.js';

const caller: Caller = { channel: 'fake', chatId: 'guard-chat', turnId: 'turn-g' };
let postgres: TestPostgres;
let db: Db;

beforeAll(async () => {
  postgres = await startPostgres();
  db = createDb(postgres.url);
  await migrateToLatest(db);
}, 180_000);

afterAll(async () => {
  await db.destroy();
  await postgres.stop();
});

beforeEach(async () => {
  await sql`alter table audit_log disable trigger user`.execute(db);
  await sql`truncate audit_log`.execute(db);
  await sql`alter table audit_log enable trigger user`.execute(db);
});

const outcomes = async (): Promise<string[]> =>
  (await db.selectFrom('audit_log').select('outcome').orderBy('id').execute()).map(
    (r) => r.outcome,
  );

const readTool = (run: ToolDefinition['run'], name = 'test.hang'): ToolDefinition => ({
  name,
  description: 'test tool',
  parameters: { type: 'object' },
  actionType: 'read',
  changesState: false,
  run,
});
/** A tool that never answers and ignores its signal. */
const hang = readTool(() => new Promise<string>(() => undefined));

it('refuses a registry with an action type nobody declared, or two tools with one model name', () => {
  const odd = { ...readTool(() => Promise.resolve('x')), actionType: 'teleport' } as never;
  expect(() => createGate({ db, tools: [odd] })).toThrow('unknown action type');
  const same = [createClockTool(), readTool(() => Promise.resolve('x'), 'clock_now')];
  expect(() => createGate({ db, tools: same })).toThrow('Two tools');
});

it('a stopped turn ends a hanging tool and writes one aborted row', async () => {
  const stop = new AbortController();
  const tool = createGate({ db, tools: [hang] }).toolsFor(caller)[0];
  const running = tool?.run({}, stop.signal);
  stop.abort();
  await expect(running).rejects.toMatchObject({ kind: 'aborted' });
  expect(await outcomes()).toEqual(['aborted']);
});

it('a turn that is already stopped never runs the tool', async () => {
  const run = vi.fn(() => Promise.resolve('x'));
  const tool = createGate({ db, tools: [readTool(run)] }).toolsFor(caller)[0];
  await expect(tool?.run({}, AbortSignal.abort())).rejects.toMatchObject({ kind: 'aborted' });
  expect(await outcomes()).toEqual(['aborted']);
});

it('a tool that takes too long is stopped, the model is told, and one error row is written', async () => {
  const tool = createGate({ db, tools: [hang], toolTimeoutMs: 30 }).toolsFor(caller)[0];
  expect(await tool?.run({})).toContain('too long');
  expect(await outcomes()).toEqual(['error']);
});

it('a failed audit write after a good run is logged and the answer still comes back', async () => {
  const broken = createDb('postgres://nobody:x@127.0.0.1:1/none');
  const error = vi.fn();
  const tool = createGate({ db: broken, logger: { error } }).toolsFor(caller)[0];
  expect(await tool?.run({})).toContain('(UTC)');
  expect(error).toHaveBeenCalledOnce();
  await broken.destroy();
});

it('a failed audit write on a refusal is not swallowed', async () => {
  const broken = createDb('postgres://nobody:x@127.0.0.1:1/none');
  const ask = { ...readTool(() => Promise.resolve('x')), actionType: 'overwrite' } as const;
  const tool = createGate({ db: broken, tools: [ask] }).toolsFor(caller)[0];
  await expect(tool?.run({})).rejects.toThrow();
  await broken.destroy();
});

it('a tool name the model made up is refused through the gate and recorded', async () => {
  const engine = new ScriptedEngine([{ tool: 'rm_rf', args: { path: '/' } }, { text: 'done' }]);
  const reply = createReplier({
    db,
    engine,
    logger: createLogger('silent'),
    gate: createGate({ db }),
    model: 'test',
    retryDelayMs: 0,
    typingIntervalMs: 5,
    turnTimeoutMs: 5000,
  });
  const turn = { id: 't', channel: 'fake', chatId: 'guard-chat', text: 'go', status: 'sending' };
  expect(await reply({ ...turn, status: 'sending' }, new FakeChannel())).toBe('done');
  const row = await db.selectFrom('audit_log').selectAll().executeTakeFirstOrThrow();
  expect(row).toMatchObject({ tool: 'rm_rf', action_type: 'unknown', outcome: 'refused' });
  expect(row).toMatchObject({ decision: 'off', arg_names: [], extra_args: 1 });
});
