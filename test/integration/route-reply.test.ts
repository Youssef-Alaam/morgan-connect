import { Writable } from 'node:stream';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createReplier, ROUTE_OFF_REPLY } from '../../src/core/index.js';
import {
  createDb,
  migrateToLatest,
  routeEnabled,
  setRoute,
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
let counter = 0;

beforeAll(async () => {
  postgres = await startPostgres();
  db = createDb(postgres.url);
  await migrateToLatest(db);
  admin = await linkChats(db, ['G0']);
}, 180_000);
afterAll(async () => {
  await db.destroy();
  await postgres.stop();
});

const turn = (text: string): Turn => ({
  id: `r${String((counter += 1))}`,
  channel: 'fake',
  chatId: 'G0',
  text,
  status: 'sending',
  ...admin,
});
const replier = (engine: ScriptedEngine, route?: string, logs?: Writable) =>
  createReplier({
    db,
    engine,
    logger: createLogger(logs === undefined ? 'silent' : 'trace', logs),
    model: 'm',
    timezone: 'UTC',
    retryDelayMs: 0,
    typingIntervalMs: 5,
    turnTimeoutMs: 5000,
    ...(route === undefined ? {} : { route }),
  });
const audits = () =>
  db
    .selectFrom('audit_log')
    .select(['tool', 'action_type', 'decision', 'outcome'])
    .where('tool', '=', 'route.switched_off')
    .execute();

it('refuses the next model call on a route switched off, with an audit row and no call', async () => {
  const engine = new ScriptedEngine([{ text: 'before' }, { text: 'after' }]);
  const reply = replier(engine, 'anthropic');
  expect(await reply(turn('one'), new FakeChannel())).toBe('before');
  expect(await setRoute(db, admin, 'anthropic', false)).toBe(true);
  expect(await reply(turn('two'), new FakeChannel())).toBe(ROUTE_OFF_REPLY);
  expect(ROUTE_OFF_REPLY).toMatch(/switched off/);
  expect(engine.opened).toHaveLength(1);
  expect(await audits()).toEqual([
    { tool: 'route.switched_off', action_type: 'model', decision: 'off', outcome: 'refused' },
  ]);
  expect(await reply(turn('/usage'), new FakeChannel())).toEqual(expect.stringContaining('Today'));
  await setRoute(db, admin, 'anthropic', true);
  expect(await reply(turn('three'), new FakeChannel())).toBe('after');
});

it('leaves other routes, and a replier with no route, alone', async () => {
  await setRoute(db, admin, 'anthropic', false);
  const engine = new ScriptedEngine([{ text: 'http ok' }, { text: 'plain ok' }]);
  expect(await replier(engine, 'http')(turn('hi'), new FakeChannel())).toBe('http ok');
  expect(await replier(engine)(turn('hi'), new FakeChannel())).toBe('plain ok');
});

it('still refuses when the audit row cannot be written', async () => {
  let logs = '';
  const sink = new Writable({
    write(chunk: Buffer, _encoding, done) {
      logs += chunk.toString();
      done();
    },
  });
  const reply = replier(new ScriptedEngine([]), 'anthropic', sink);
  await db.schema.alterTable('audit_log').renameTo('audit_log_gone').execute();
  try {
    expect(await reply(turn('x'), new FakeChannel())).toBe(ROUTE_OFF_REPLY);
  } finally {
    await db.schema.alterTable('audit_log_gone').renameTo('audit_log').execute();
  }
  expect(logs).toContain('route refusal not audited');
});

it('lets only an admin switch a route, and audits the refusal', async () => {
  const member = await db
    .insertInto('users')
    .values({ role: 'member', workspace_id: admin.workspaceId })
    .returning('id')
    .executeTakeFirstOrThrow();
  const who = { userId: member.id, workspaceId: admin.workspaceId };
  expect(await setRoute(db, who, 'http', false)).toBe(false);
  expect(await routeEnabled(db, 'http')).toBe(true);
  expect(await setRoute(db, admin, 'Bad Id!', false)).toBe(false);
  const refused = await db
    .selectFrom('audit_log')
    .select('id')
    .where('tool', '=', 'admin.route.set')
    .where('outcome', '=', 'refused')
    .execute();
  expect(refused).toHaveLength(2);
});
