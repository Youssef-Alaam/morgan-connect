import { sql } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createSession, type Owner } from '../../src/data/index.js';
import { createApp } from '../../src/http/index.js';
import { sha256 } from '../../src/identity/admin-link.js';
import { createIdentity } from '../../src/identity/index.js';
import { createLogger } from '../../src/ops/index.js';
import { startIsolation, type Isolation } from '../helpers/isolation.js';

let ctx: Isolation;
let app: ReturnType<typeof createApp>;
let sessions = 0;

beforeAll(async () => {
  ctx = await startIsolation();
  app = createApp({
    dbVersion: () => Promise.resolve('17'),
    logger: createLogger('silent'),
    auth: { db: ctx.app },
  });
}, 180_000);
afterAll(async () => {
  await ctx.stop();
});

/** A signed-in browser for this person: a live session, as the cookie a sign-in would set. */
async function cookieFor(who: Owner): Promise<string> {
  sessions += 1;
  const token = `session-${String(sessions)}`;
  await createSession(ctx.app, who, {
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  return `morgan_session=${token}`;
}
const call = (method: string, path: string, cookie: string) =>
  app.request(`/api/${path}`, {
    method,
    headers: { 'content-type': 'application/json', cookie },
    ...(method === 'POST' ? { body: '{}' } : {}),
  });
const ownerOfChat = async (chatId: string) =>
  (
    await ctx.owner
      .selectFrom('devices')
      .select('user_id')
      .where('chat_id', '=', chatId)
      .executeTakeFirst()
  )?.user_id;
const auditRows = async (tool: string) =>
  (
    await sql<{
      user_id: string | null;
      outcome: string;
      subject_user_id: string | null;
      reason: string | null;
    }>`
      select user_id, outcome, subject_user_id, reason from audit_log
      where tool = ${tool} order by created_at`.execute(ctx.owner)
  ).rows;

it('a signed-in member gets a code that links a chat to them, and only a session can ask', async () => {
  expect((await call('POST', 'link-codes', '')).status).toBe(401);
  const response = await call('POST', 'link-codes', await cookieFor(ctx.bob));
  const body = (await response.json()) as { code: string; expiresInMinutes: number };
  expect(body.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  expect(body.expiresInMinutes).toBe(10);
  expect(await createIdentity(ctx.app).link('fake', 'w1', body.code)).toBe('claimed');
  expect(await ownerOfChat('w1')).toBe(ctx.bob.userId);
});

it('a new code replaces the last unused one', async () => {
  const cookie = await cookieFor(ctx.bob);
  const first = (await (await call('POST', 'link-codes', cookie)).json()) as { code: string };
  await call('POST', 'link-codes', cookie);
  expect(await createIdentity(ctx.app).link('fake', 'w2', first.code)).toBe('refused');
});

const unlink = async (cookie: string, id: string) =>
  (await call('DELETE', `devices/${id}`, cookie)).status;
const idAt = (list: { id: string }[], index: number) => list[index]?.id ?? '';

it('lists a person own chats, and unlinking by the member or the admin writes an audit row', async () => {
  await ctx.owner
    .insertInto('devices')
    .values([
      { user_id: ctx.bob.userId, channel: 'fake', chat_id: 'u1' },
      { user_id: ctx.bob.userId, channel: 'fake', chat_id: 'u2' },
    ])
    .execute();
  const bob = await cookieFor(ctx.bob);
  const alice = await cookieFor(ctx.alice);
  const mine = (await (await call('GET', 'devices', bob)).json()) as { id: string }[];
  expect(mine.length).toBeGreaterThanOrEqual(3);
  const theirs = (await (await call('GET', 'devices', alice)).json()) as { id: string }[];
  expect(theirs).toHaveLength(1);
  // A member cannot remove another person's chat; the answer is the same as for no chat at all.
  expect(await unlink(bob, idAt(theirs, 0))).toBe(404);
  expect((await call('DELETE', 'devices/not-an-id', bob)).status).toBe(404);
  expect(await ownerOfChat('a')).toBe(ctx.alice.userId);
  const [first, second] = [idAt(mine, 0), idAt(mine, 1)];
  expect(await unlink(bob, first)).toBe(204);
  expect(await unlink(alice, second)).toBe(204);
  expect(await unlink(bob, first)).toBe(404);
  // A browser session's own device cannot be removed this way.
  const web = await ctx.owner
    .selectFrom('devices')
    .select('id')
    .where('channel', '=', 'web')
    .executeTakeFirstOrThrow();
  expect(await unlink(alice, web.id)).toBe(404);
  const rows = await auditRows('device.unlink');
  expect(rows.map((r) => [r.user_id, r.outcome])).toEqual([
    [ctx.bob.userId, 'refused'],
    [ctx.bob.userId, 'ok'],
    [ctx.alice.userId, 'ok'],
    [ctx.bob.userId, 'refused'],
    [ctx.alice.userId, 'refused'],
  ]);
  expect(rows.map((r) => r.subject_user_id)).toEqual([
    null,
    ctx.bob.userId,
    ctx.bob.userId,
    null,
    null,
  ]);
  // Refused tries name the device that was asked for.
  expect(rows.map((r) => r.reason)).toEqual([idAt(theirs, 0), first, second, first, web.id]);
});

it('limits how many codes one person may ask for', async () => {
  const member = await ctx.owner
    .insertInto('users')
    .values({ role: 'member', told_admin_can_read_at: new Date() })
    .returning(['id', 'workspace_id'])
    .executeTakeFirstOrThrow();
  await ctx.owner
    .insertInto('credentials')
    .values({
      user_id: member.id,
      workspace_id: member.workspace_id,
      email: 'limit@example.test',
      password_hash: 'h',
    })
    .execute();
  const cookie = await cookieFor({ userId: member.id, workspaceId: member.workspace_id });
  const statuses: number[] = [];
  for (let i = 0; i < 6; i += 1) statuses.push((await call('POST', 'link-codes', cookie)).status);
  expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
});

it('removes nothing when no person is set on the transaction', async () => {
  const before = await ctx.owner.selectFrom('devices').select('id').execute();
  const bare = await ctx.app.transaction().execute((trx) =>
    sql<{
      owner: string | null;
    }>`select member_unlink_device(${before[0]?.id ?? ''}::uuid) as owner`.execute(trx),
  );
  expect(bare.rows[0]?.owner).toBeNull();
  expect(await ctx.owner.selectFrom('devices').select('id').execute()).toHaveLength(before.length);
});
