import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createReplier, ROUTE_OFF_REPLY } from '../../src/core/index.js';
import {
  createDb,
  migrateToLatest,
  setRoute,
  type Db,
  type Owner,
  type Turn,
} from '../../src/data/index.js';
import { atomicWrite, createLogger } from '../../src/ops/index.js';
import { createGate } from '../../src/policy/index.js';
import { FakeChannel } from '../helpers/fake-channel.js';
import { ScriptedEngine } from '../helpers/fake-engine.js';
import { linkChats } from '../helpers/link-chats.js';
import { startPostgres, type TestPostgres } from '../helpers/postgres.js';

let postgres: TestPostgres;
let db: Db;
let admin: Owner;
let dir: string;
let counter = 0;
let seen = 0;
const file = (): string => join(dir, 'routes.json');
const NOW = new Date('2026-11-28T12:00:00Z');

const writeRoute = async (patch: Record<string, unknown> = {}): Promise<void> => {
  const row = {
    id: 'anthropic',
    label: 'Anthropic API key',
    verdict: 'allowed',
    source: 'https://example.com/terms',
    verified: '2026-11-24',
    ...patch,
  };
  await atomicWrite(file(), JSON.stringify({ routes: [row] }));
};

beforeAll(async () => {
  postgres = await startPostgres();
  db = createDb(postgres.url);
  await migrateToLatest(db);
  admin = await linkChats(db, ['G0']);
  dir = mkdtempSync(join(tmpdir(), 'terms-policy-'));
}, 180_000);
afterAll(async () => {
  await db.destroy();
  await postgres.stop();
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  await writeRoute();
  await setRoute(db, admin, 'anthropic', true);
  seen = (await routeRows()).length;
});

const turn = (text: string): Turn => ({
  id: `t${String((counter += 1))}`,
  channel: 'fake',
  chatId: 'G0',
  text,
  status: 'sending',
  ...admin,
});
const logger = createLogger('silent');
const gate = (optedIn?: (route: string) => boolean) =>
  createGate({
    db,
    logger,
    now: () => NOW,
    routesFile: file(),
    ...(optedIn === undefined ? {} : { routeOptedIn: optedIn }),
  });
const replier = (engine: ScriptedEngine, route = 'anthropic', optedIn?: (r: string) => boolean) =>
  createReplier({
    db,
    engine,
    logger,
    model: 'm',
    timezone: 'UTC',
    retryDelayMs: 0,
    typingIntervalMs: 5,
    turnTimeoutMs: 5000,
    route,
    gate: gate(optedIn),
  });
const routeRows = () =>
  db
    .selectFrom('audit_log')
    .select(['tool', 'action_type', 'decision', 'outcome'])
    .where('tool', 'like', 'route.%')
    .orderBy('created_at')
    .execute();
/** The route refusals written since this test began (the audit log is append-only). */
const refusals = async () => (await routeRows()).slice(seen);

it('answers while the route is allowed and verified, then refuses the next call when the file says off', async () => {
  const engine = new ScriptedEngine([{ text: 'fine' }, { text: 'never' }]);
  const reply = replier(engine);
  expect(await reply(turn('one'), new FakeChannel())).toBe('fine');
  await writeRoute({ verdict: 'off' });
  const refused = await reply(turn('two'), new FakeChannel());
  expect(refused).toMatch(/Anthropic API key route is switched off.*terms policy file/);
  expect(engine.opened).toHaveLength(1);
  expect(await refusals()).toEqual([
    { tool: 'route.terms_refused', action_type: 'model', decision: 'off', outcome: 'refused' },
  ]);
});

it('refuses a route not re-verified for 91 days, and says which route and why', async () => {
  await writeRoute({ verified: '2026-08-29' });
  const engine = new ScriptedEngine([{ text: 'never' }]);
  const refused = await replier(engine)(turn('hi'), new FakeChannel());
  expect(refused).toMatch(/Anthropic API key.*91 days ago/);
  expect(engine.opened).toHaveLength(0);
  await writeRoute({ verified: '2026-08-30' });
  engine.opened.length = 0;
  expect(await replier(new ScriptedEngine([{ text: 'ok' }]))(turn('hi'), new FakeChannel())).toBe(
    'ok',
  );
});

it('needs both locks: the admin switch still stops a route the file allows', async () => {
  await setRoute(db, admin, 'anthropic', false);
  const engine = new ScriptedEngine([{ text: 'never' }]);
  expect(await replier(engine)(turn('hi'), new FakeChannel())).toBe(ROUTE_OFF_REPLY);
  expect(engine.opened).toHaveLength(0);
  expect((await refusals()).map((row) => row.tool)).toEqual(['route.switched_off']);
});

it('keeps a grey route off until the admin opts in', async () => {
  await writeRoute({ verdict: 'grey' });
  const engine = new ScriptedEngine([{ text: 'in' }]);
  expect(await replier(engine)(turn('hi'), new FakeChannel())).toMatch(/grey route/);
  expect(await replier(engine, 'anthropic', () => true)(turn('hi'), new FakeChannel())).toBe('in');
});

it('refuses every model call when the file cannot be read', async () => {
  await atomicWrite(file(), '{ not json');
  const engine = new ScriptedEngine([{ text: 'never' }]);
  expect(await replier(engine)(turn('hi'), new FakeChannel())).toMatch(/could not be read/);
  expect(engine.opened).toHaveLength(0);
});

it('applies to a safety-model call and an unlisted route through the same gate', async () => {
  const caller = { channel: 'fake', chatId: 'G0' };
  expect(await gate().refuseModelCall(caller, 'anthropic')).toBeUndefined();
  expect(await gate().refuseModelCall(caller, 'safety')).toMatch(
    /safety route is not in the terms policy file/,
  );
  await writeRoute({ verdict: 'off' });
  expect(await gate().refuseModelCall(caller, 'anthropic')).toMatch(/switched off/);
  expect((await refusals()).map((row) => row.tool)).toEqual([
    'route.terms_refused',
    'route.terms_refused',
  ]);
});

it('leaves a self-hosted engine route to the admin switch alone', async () => {
  const engine = new ScriptedEngine([{ text: 'own' }]);
  expect(await replier(engine, 'http')(turn('hi'), new FakeChannel())).toBe('own');
});
