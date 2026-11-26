import { Writable } from 'node:stream';
import { sql } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { adminRead } from '../../src/data/admin-read.js';
import { createSession } from '../../src/data/index.js';
import { createApp } from '../../src/http/index.js';
import { sha256 } from '../../src/identity/admin-link.js';
import { createLogger } from '../../src/ops/index.js';
import { startIsolation, type Isolation } from '../helpers/isolation.js';

let ctx: Isolation;
let app: ReturnType<typeof createApp>;
let logs = '';
const ADMIN = 'morgan_session=admin-tok';
const MEMBER = 'morgan_session=member-tok';
const NOTICE = 'join.notice.admin_can_read';
const cookieOf = (response: Response) =>
  /morgan_session=[^;]+/.exec(response.headers.get('set-cookie') ?? '')?.[0] ?? '';

beforeAll(async () => {
  ctx = await startIsolation();
  const sink = new Writable({
    write(chunk: Buffer, _encoding, done) {
      logs += chunk.toString();
      done();
    },
  });
  const logger = createLogger('trace', sink);
  app = createApp({ dbVersion: () => Promise.resolve('17'), logger, auth: { db: ctx.app } });
  const expiresAt = new Date(Date.now() + 3_600_000);
  await createSession(ctx.app, ctx.alice, { tokenHash: sha256('admin-tok'), expiresAt });
  await createSession(ctx.app, ctx.bob, { tokenHash: sha256('member-tok'), expiresAt });
}, 180_000);
afterAll(async () => {
  await ctx.stop();
});

const post = (path: string, body: unknown, cookie = '') =>
  app.request(`/api/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
const audits = (tool: string) =>
  sql<{ outcome: string; user_id: string }>`
    select outcome, user_id from audit_log where tool = ${tool} order by id`
    .execute(ctx.owner)
    .then((result) => result.rows);

it('lets only the admin make invites and accounts; a member is refused and audited', async () => {
  expect((await post('invites', {})).status).toBe(401);
  expect((await post('invites', { ttlHours: 0 }, ADMIN)).status).toBe(400);
  expect((await post('invites', {}, MEMBER)).status).toBe(403);
  expect((await post('accounts', { email: 'x@example.test' }, MEMBER)).status).toBe(403);
  const refused = [{ outcome: 'refused', user_id: ctx.bob.userId }];
  expect(await audits('admin.invite.create')).toEqual(refused);
  expect(await audits('admin.account.create')).toEqual(refused);
  // Only the two seeded invites exist: nothing was written for the member.
  expect(await ctx.owner.selectFrom('invites').select('id').execute()).toHaveLength(2);
});

it('makes an invite that joins with its role and limit, stored only as a hash', async () => {
  const made = await post('invites', { monthlyLimitUsd: 7.5 }, ADMIN);
  expect(made.status).toBe(200);
  const { token } = (await made.json()) as { token: string };
  const stored = await ctx.owner.selectFrom('invites').select('token_hash').execute();
  expect(stored.map((row) => row.token_hash)).toContain(sha256(token));
  expect(stored.map((row) => row.token_hash)).not.toContain(token);
  expect((await audits('admin.invite.create')).map((row) => row.outcome)).toEqual([
    'refused',
    'ok',
  ]);
  const join = { token, email: 'j@example.test', password: 'a brand new password' };
  expect((await post('join', { ...join, acceptedNotice: true })).status).toBe(200);
  const joined = await ctx.owner
    .selectFrom('users')
    .select(['role', 'monthly_limit_usd'])
    .where('monthly_limit_usd', '=', '7.50')
    .execute();
  expect(joined).toEqual([{ role: 'member', monthly_limit_usd: '7.50' }]);
  expect(logs).not.toContain(token);
});

it('makes an account with a temporary password, shown once, that must be changed', async () => {
  const made = await post('accounts', { email: 'Temp@example.test' }, ADMIN);
  const { temporaryPassword } = (await made.json()) as { temporaryPassword: string };
  expect((await post('accounts', { email: 'temp@example.test' }, ADMIN)).status).toBe(409);
  expect((await audits('admin.account.create')).map((row) => row.outcome)).toEqual([
    'refused',
    'ok',
  ]);
  const subject = await ctx.owner
    .selectFrom('audit_log')
    .select('subject_user_id')
    .where('tool', '=', 'admin.account.create')
    .where('outcome', '=', 'ok')
    .executeTakeFirstOrThrow();
  const member = await ctx.owner
    .selectFrom('credentials')
    .select(['user_id', 'workspace_id'])
    .where('email', '=', 'temp@example.test')
    .executeTakeFirstOrThrow();
  expect(subject.subject_user_id).toBe(member.user_id);
  const login = { email: 'temp@example.test', password: temporaryPassword };
  const cookie = cookieOf(await post('sign-in', login));
  const other = cookieOf(await post('sign-in', login));
  expect((await app.request('/api/me', { headers: { cookie } })).status).toBe(403);
  expect((await post('invites', {}, cookie)).status).toBe(403);
  const change = { current: temporaryPassword, password: 'a brand new password' };
  const noNotice = await post('change-password', change, cookie);
  expect(await noNotice.json()).toEqual({ error: 'notice_required', notice: NOTICE });
  const wrong = { ...change, current: 'not the password', acceptedNotice: true };
  expect((await post('change-password', wrong, cookie)).status).toBe(401);
  const same = { current: temporaryPassword, password: temporaryPassword, acceptedNotice: true };
  expect((await post('change-password', same, cookie)).status).toBe(400);
  expect((await post('change-password', { ...change, acceptedNotice: true }, cookie)).status).toBe(
    200,
  );
  expect((await app.request('/api/me', { headers: { cookie } })).status).toBe(200);
  // Changing the password ends the person's other sessions.
  expect((await app.request('/api/me', { headers: { cookie: other } })).status).toBe(401);
  // Told now, so the admin's audited read of this member is no longer refused.
  const told = { userId: member.user_id, workspaceId: member.workspace_id };
  expect(await adminRead.chat(ctx.app, ctx.alice, told.userId, 'after notice')).toEqual([]);
  expect(logs).not.toContain(temporaryPassword);
});
