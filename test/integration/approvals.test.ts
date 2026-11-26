import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createDb, migrateToLatest, type Db, type Owner } from '../../src/data/index.js';
import { approvalHash } from '../../src/policy/approval-hash.js';
import { createApprovals, type ApprovalPrompt } from '../../src/policy/approvals.js';
import { linkChats } from '../helpers/link-chats.js';
import { startPostgres, type TestPostgres } from '../helpers/postgres.js';

const TTL_MS = 60_000;
const OWNER_CHAT = { channel: 'fake', chatId: 'owner-chat' };
const caller = { ...OWNER_CHAT, turnId: 'turn-1' };
const tool = { name: 'demo.gated', actionType: 'overwrite' } as const;
let postgres: TestPostgres;
let db: Db;
let owner: Owner;
let clock: number;

beforeAll(async () => {
  postgres = await startPostgres();
  db = createDb(postgres.url);
  await migrateToLatest(db);
  owner = await linkChats(db, ['owner-chat']);
  const member = await db
    .insertInto('users')
    .values({ role: 'member' })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('devices')
    .values({ user_id: member.id, channel: 'fake', chat_id: 'member-chat' })
    .execute();
}, 180_000);

afterAll(async () => {
  await db.destroy();
  await postgres.stop();
});

beforeEach(async () => {
  clock = Date.parse('2026-11-26T10:00:00Z');
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  await sql`truncate approvals`.execute(db);
});

afterEach(() => {
  vi.useRealTimers();
});

const statusOf = async (id: string): Promise<string | undefined> =>
  (await db.selectFrom('approvals').select('status').where('id', '=', id).executeTakeFirst())
    ?.status;

function setup(prompt?: (p: ApprovalPrompt) => Promise<void>) {
  const listeners: ((prompt: ApprovalPrompt) => void)[] = [];
  const approvals = createApprovals({
    db,
    ttlMs: TTL_MS,
    now: () => new Date(clock),
    prompt:
      prompt ??
      ((p) => {
        listeners.shift()?.(p);
        return Promise.resolve();
      }),
  });
  const ask = async (args: Record<string, unknown>, signal?: AbortSignal, who = caller) => {
    const shown = new Promise<ApprovalPrompt>((resolve) => listeners.push(resolve));
    const verdict = approvals.request({ caller: who, tool, args, signal });
    return { verdict, prompt: await shown };
  };
  return { approvals, ask };
}

it('shows the exact arguments, then approves once and spends the approval', async () => {
  const { approvals, ask } = setup();
  const { verdict, prompt } = await ask({ note: 'hi' });
  expect(prompt.text).toContain('demo.gated');
  expect(prompt.text).toContain('"note": "hi"');
  expect(prompt.expiresAt.getTime()).toBe(clock + TTL_MS);
  expect(await statusOf(prompt.id)).toBe('pending');
  expect(await approvals.decide(prompt.id, 'approved', OWNER_CHAT)).toBe(true);
  expect(await verdict).toBe('approved');
  expect(await statusOf(prompt.id)).toBe('used');
  expect(await approvals.decide(prompt.id, 'approved', OWNER_CHAT)).toBe(false);
});

it('stores the hash of the call under the owner, never the arguments', async () => {
  const { approvals, ask } = setup();
  const { verdict, prompt } = await ask({ note: 'private words' });
  await approvals.decide(prompt.id, 'denied', OWNER_CHAT);
  await verdict;
  const row = await db.selectFrom('approvals').selectAll().executeTakeFirstOrThrow();
  expect(row).toMatchObject({
    user_id: owner.userId,
    workspace_id: owner.workspaceId,
    turn_id: 'turn-1',
  });
  expect(row.args_sha256).toBe(approvalHash('demo.gated', { note: 'private words' }));
  expect(JSON.stringify(row)).not.toContain('private words');
});

it('counts exactly one of two taps that arrive together', async () => {
  const { approvals, ask } = setup();
  const { verdict, prompt } = await ask({ note: 'x' });
  const taps = await Promise.all([
    approvals.decide(prompt.id, 'approved', OWNER_CHAT),
    approvals.decide(prompt.id, 'denied', OWNER_CHAT),
  ]);
  expect(taps.filter(Boolean)).toHaveLength(1);
  expect(await verdict).toBe(taps[0] ? 'approved' : 'denied');
});

it('answers denied after Deny', async () => {
  const { approvals, ask } = setup();
  const { verdict, prompt } = await ask({ note: 'x' });
  await approvals.decide(prompt.id, 'denied', OWNER_CHAT);
  expect(await verdict).toBe('denied');
  expect(await statusOf(prompt.id)).toBe('denied');
});

it('lets only the linked owner chat answer', async () => {
  const { approvals, ask } = setup();
  const { verdict, prompt } = await ask({ note: 'x' });
  for (const stranger of [
    { channel: 'fake', chatId: 'member-chat' },
    { channel: 'fake', chatId: 'nobody' },
    { channel: 'other', chatId: 'owner-chat' },
  ]) {
    expect(await approvals.decide(prompt.id, 'approved', stranger)).toBe(false);
  }
  expect(await statusOf(prompt.id)).toBe('pending');
  await approvals.decide(prompt.id, 'approved', OWNER_CHAT);
  expect(await verdict).toBe('approved');
});

it('gives each call its own question: approving one leaves a call with other arguments waiting', async () => {
  const { approvals, ask } = setup();
  const first = await ask({ note: 'first' });
  const second = await ask({ note: 'changed' });
  expect(second.prompt.id).not.toBe(first.prompt.id);
  await approvals.decide(first.prompt.id, 'approved', OWNER_CHAT);
  expect(await first.verdict).toBe('approved');
  expect(await statusOf(second.prompt.id)).toBe('pending');
  await approvals.decide(second.prompt.id, 'denied', OWNER_CHAT);
  expect(await second.verdict).toBe('denied');
});

it('expires after the set time, and a late tap fails', async () => {
  const { approvals, ask } = setup();
  const { verdict, prompt } = await ask({ note: 'x' });
  clock += TTL_MS;
  await vi.advanceTimersByTimeAsync(TTL_MS);
  expect(await verdict).toBe('expired');
  expect(await approvals.decide(prompt.id, 'approved', OWNER_CHAT)).toBe(false);
  expect(await statusOf(prompt.id)).toBe('expired');
});

it('stops waiting when the turn is aborted, and cancels the question', async () => {
  const { ask } = setup();
  const stop = new AbortController();
  const { verdict, prompt } = await ask({ note: 'x' }, stop.signal);
  stop.abort();
  expect(await verdict).toBe('aborted');
  expect(await statusOf(prompt.id)).toBe('cancelled');
});

it('does not ask when the chat has no owner, the args are too long, or the turn already stopped', async () => {
  const prompt = vi.fn(() => Promise.resolve());
  const { approvals } = setup(prompt);
  const stop = AbortSignal.abort();
  expect(await approvals.request({ caller, tool, args: {}, signal: stop })).toBe('aborted');
  const stranger = { channel: 'fake', chatId: 'nobody' };
  expect(await approvals.request({ caller: stranger, tool, args: { a: 1 } })).toBe('unavailable');
  expect(await approvals.request({ caller, tool, args: { a: 'x'.repeat(3500) } })).toBe(
    'unavailable',
  );
  expect(prompt).not.toHaveBeenCalled();
  expect(await db.selectFrom('approvals').select('id').execute()).toHaveLength(0);
});

it('cancels the question when it cannot be shown', async () => {
  const { approvals } = setup(() => Promise.reject(new Error('telegram down')));
  expect(await approvals.request({ caller, tool, args: { note: 'x' } })).toBe('unavailable');
  const row = await db.selectFrom('approvals').select('status').executeTakeFirstOrThrow();
  expect(row.status).toBe('cancelled');
});
