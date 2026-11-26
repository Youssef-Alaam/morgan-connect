import { Writable } from 'node:stream';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { BUDGET_REPLY, createReplier, type ReplyDeps } from '../../src/core/index.js';
import {
  createDb,
  createInvite,
  migrateToLatest,
  redeemInvite,
  setBudget,
  type Db,
  type Owner,
  type Turn,
} from '../../src/data/index.js';
import { createLogger } from '../../src/ops/index.js';
import { ScriptedEngine } from '../helpers/fake-engine.js';
import { FakeChannel } from '../helpers/fake-channel.js';
import { linkChats } from '../helpers/link-chats.js';
import { startPostgres, type TestPostgres } from '../helpers/postgres.js';

let postgres: TestPostgres;
let db: Db;
let admin: Owner;
let who: Owner;
let counter = 0;

beforeAll(async () => {
  postgres = await startPostgres();
  db = createDb(postgres.url);
  await migrateToLatest(db);
  admin = await linkChats(db, ['G0']);
  const member = await db
    .insertInto('users')
    .values({ role: 'member', workspace_id: admin.workspaceId })
    .returning('id')
    .executeTakeFirstOrThrow();
  who = { userId: member.id, workspaceId: admin.workspaceId };
  await db
    .insertInto('devices')
    .values({ user_id: who.userId, channel: 'fake', chat_id: 'G1' })
    .execute();
}, 180_000);
afterAll(async () => {
  await db.destroy();
  await postgres.stop();
});

const turn = (text: string): Turn => ({
  id: `g${String((counter += 1))}`,
  channel: 'fake',
  chatId: 'G1',
  text,
  status: 'sending',
  ...who,
});
const replier = (engine: ScriptedEngine, budget: ReplyDeps['budget']) =>
  createReplier({
    db,
    engine,
    logger: createLogger('silent'),
    model: 'm',
    timezone: 'UTC',
    retryDelayMs: 0,
    typingIntervalMs: 5,
    turnTimeoutMs: 5000,
    ...(budget === undefined ? {} : { budget }),
  });
const audits = () =>
  db
    .selectFrom('audit_log')
    .select(['tool', 'action_type', 'decision', 'outcome', 'arg_names'])
    .where('tool', '=', 'budget.monthly')
    .execute();
const calls = async () => (await db.selectFrom('usage_ledger').select('id').execute()).length;

it('lets a running turn finish, then refuses the next one before any model call', async () => {
  await setBudget(db, admin, who.userId, '0.005');
  const engine = new ScriptedEngine([{ text: 'first', tokens: 5 }, { text: 'never' }]);
  const reply = replier(engine, { keySource: 'admin' });
  expect(await reply(turn('one'), new FakeChannel())).toBe('first');
  expect(await calls()).toBe(1);
  expect(await reply(turn('two'), new FakeChannel())).toEqual({
    text: BUDGET_REPLY,
    askMore: true,
  });
  expect(BUDGET_REPLY).toBe("You've reached this month's limit.");
  expect(engine.opened).toHaveLength(1);
  expect(await calls()).toBe(1);
  expect(await audits()).toEqual([
    {
      tool: 'budget.monthly',
      action_type: 'model',
      decision: 'off',
      outcome: 'refused',
      arg_names: [],
    },
  ]);
});

it('never refuses the admin: a default of 0 still reaches the model', async () => {
  const engine = new ScriptedEngine([{ text: 'admin answer' }]);
  const reply = replier(engine, { keySource: 'admin', defaultLimitUsd: '0' });
  expect(await reply({ ...turn('hi'), ...admin, chatId: 'G0' }, new FakeChannel())).toBe(
    'admin answer',
  );
  expect(engine.opened).toHaveLength(1);
});

it('does not limit commands, a person own key, or an install with no limit', async () => {
  const engine = new ScriptedEngine([{ text: 'own key answer' }, { text: 'no budget answer' }]);
  expect(await replier(engine, { keySource: 'own' })(turn('hi'), new FakeChannel())).toBe(
    'own key answer',
  );
  expect(await replier(engine, undefined)(turn('hi'), new FakeChannel())).toBe('no budget answer');
  const usage = await replier(engine, { keySource: 'admin' })(turn('/usage'), new FakeChannel());
  expect(usage).toEqual(expect.stringContaining('Today'));
});

it('still refuses when the audit row cannot be written', async () => {
  let logs = '';
  const sink = new Writable({
    write(chunk: Buffer, _encoding, done) {
      logs += chunk.toString();
      done();
    },
  });
  const engine = new ScriptedEngine([]);
  const broken = createReplier({
    db,
    engine,
    logger: createLogger('trace', sink),
    model: 'm',
    timezone: 'UTC',
    retryDelayMs: 0,
    typingIntervalMs: 5,
    turnTimeoutMs: 5000,
    budget: { keySource: 'admin' },
  });
  await db.schema.alterTable('audit_log').renameTo('audit_log_gone').execute();
  try {
    expect(await broken(turn('x'), new FakeChannel())).toMatchObject({ askMore: true });
  } finally {
    await db.schema.alterTable('audit_log_gone').renameTo('audit_log').execute();
  }
  expect(logs).toContain('budget refusal not audited');
});

it('holds a member who joined by invite to the invite limit: answered, then refused', async () => {
  const invited = { tokenHash: 'inv-e2e', ttlSeconds: 600, monthlyLimitUsd: 0.005 };
  expect(await createInvite(db, admin, invited)).toBe(true);
  const joined = await redeemInvite(db, {
    tokenHash: 'inv-e2e',
    email: 'e@x.test',
    passwordHash: 'p',
  });
  if (joined === undefined) throw new Error('the invite was not accepted');
  await db
    .insertInto('devices')
    .values({ user_id: joined.userId, channel: 'fake', chat_id: 'G2' })
    .execute();
  const engine = new ScriptedEngine([{ text: 'first', tokens: 5 }, { text: 'never' }]);
  const reply = replier(engine, { keySource: 'admin' });
  const mine = { ...turn('hi'), ...joined, chatId: 'G2' };
  expect(await reply(mine, new FakeChannel())).toBe('first');
  expect(await reply({ ...mine, id: 'e2e-2' }, new FakeChannel())).toEqual({
    text: BUDGET_REPLY,
    askMore: true,
  });
  expect(engine.opened).toHaveLength(1);
});
