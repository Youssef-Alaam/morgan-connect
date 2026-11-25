import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { ingest, type PipelineDeps } from '../../src/core/index.js';
import {
  createDb,
  createTurnQueue,
  migrateToLatest,
  type Db,
  type TurnQueue,
} from '../../src/data/index.js';
import { createIdentity, type Identity } from '../../src/identity/index.js';
import { createLogger } from '../../src/ops/index.js';
import { FakeChannel } from '../helpers/fake-channel.js';
import { startPostgres, type TestPostgres } from '../helpers/postgres.js';

let postgres: TestPostgres;
let db: Db;
let queue: TurnQueue;
let identity: Identity;
let channel: FakeChannel;
let clock = 0;

beforeAll(async () => {
  postgres = await startPostgres();
  db = createDb(postgres.url);
  await migrateToLatest(db);
  queue = createTurnQueue(postgres.url, () => undefined);
  await queue.start();
}, 180_000);

afterAll(async () => {
  await queue.stop();
  await db.destroy();
  await postgres.stop();
});

beforeEach(async () => {
  await sql`truncate devices, users, setup_codes, turns cascade`.execute(db);
  clock = 0;
  identity = createIdentity(db, { now: () => clock });
  channel = new FakeChannel();
});

const deps = (): PipelineDeps => ({
  db,
  queue,
  senders: [channel],
  logger: createLogger('silent'),
  retryDelayMs: 0,
  identity,
});
const msg = (chatId: string, text: string, messageId = text) => ({
  channel: 'fake',
  chatId,
  messageId,
  text,
});
const turnCount = async (): Promise<number> =>
  Number((await sql<{ n: string }>`select count(*) as n from turns`.execute(db)).rows[0]?.n);

it('a setup code claims the install once and only once', async () => {
  const code = await identity.issueSetupCode();
  expect(code).toBeDefined();
  expect(await identity.claim('fake', '1', code ?? '')).toBe('claimed');
  expect(await identity.isLinked('fake', '1')).toBe(true);
  expect(await identity.claim('fake', '2', code ?? '')).toBe('refused');
  expect(await identity.isLinked('fake', '2')).toBe(false);
  expect(await identity.issueSetupCode()).toBeUndefined();
});

it('issues a fresh code on each start while unclaimed; the old one stops working', async () => {
  const first = await identity.issueSetupCode();
  const second = await identity.issueSetupCode();
  expect(second).not.toBe(first);
  expect(await identity.claim('fake', '1', first ?? '')).toBe('refused');
  expect(await identity.claim('fake', '1', second ?? '')).toBe('claimed');
});

it('refuses a wrong code and rate-limits the chat, even for the right code', async () => {
  const code = (await identity.issueSetupCode()) ?? '';
  for (let i = 0; i < 5; i += 1)
    expect(await identity.claim('fake', '9', `wrong${String(i)}`)).toBe('refused');
  expect(await identity.claim('fake', '9', code)).toBe('limited');
  expect(await identity.isLinked('fake', '9')).toBe(false);
  expect(await identity.claim('fake', '1', code)).toBe('claimed');
});

it('lets a chat try again once the rate-limit window has passed', async () => {
  const code = (await identity.issueSetupCode()) ?? '';
  for (let i = 0; i < 5; i += 1) await identity.claim('fake', '9', 'wrong');
  clock += 16 * 60 * 1000;
  expect(await identity.claim('fake', '9', code)).toBe('claimed');
});

it('stores only a hash of the code', async () => {
  const code = (await identity.issueSetupCode()) ?? '';
  const { rows } = await sql<{ code_hash: string }>`select code_hash from setup_codes`.execute(db);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.code_hash).toMatch(/^[0-9a-f]{64}$/);
  expect(JSON.stringify(rows)).not.toContain(code);
});

it('a message from an unlinked chat creates no turn and gets no reply', async () => {
  await identity.issueSetupCode();
  await ingest(deps(), msg('7', 'hello'));
  await ingest(deps(), msg('7', '/start not-the-code'));
  await ingest(deps(), msg('7', '/start'));
  expect(await turnCount()).toBe(0);
  expect(channel.attempts).toEqual([]);
});

it('/start <code> links the chat, confirms once, and later messages become turns', async () => {
  const code = (await identity.issueSetupCode()) ?? '';
  await ingest(deps(), msg('7', `/start ${code}`));
  expect(channel.attempts).toEqual([{ chatId: '7', text: 'Linked. This chat is now the admin.' }]);
  expect(await turnCount()).toBe(0);
  await ingest(deps(), msg('7', 'hello'));
  expect(await turnCount()).toBe(1);
  await ingest(deps(), msg('8', 'hello'));
  expect(await turnCount()).toBe(1);
});

it('still links the chat when the confirmation cannot be sent', async () => {
  const code = (await identity.issueSetupCode()) ?? '';
  channel.failures = 1;
  await ingest(deps(), msg('7', `/start ${code}`));
  expect(await identity.isLinked('fake', '7')).toBe(true);
});
