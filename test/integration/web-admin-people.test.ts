import { sql } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createSession, type Owner } from '../../src/data/index.js';
import { createApp } from '../../src/http/index.js';
import { sha256 } from '../../src/identity/admin-link.js';
import { createLogger } from '../../src/ops/index.js';
import { startIsolation, type Isolation } from '../helpers/isolation.js';

let ctx: Isolation;
let app: ReturnType<typeof createApp>;
let admin = '';
let member = '';

beforeAll(async () => {
  ctx = await startIsolation();
  app = createApp({
    dbVersion: () => Promise.resolve('17'),
    logger: createLogger('silent'),
    auth: { db: ctx.app },
  });
  const cookieFor = async (who: Owner, token: string) => {
    await createSession(ctx.app, who, {
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    return `morgan_session=${token}`;
  };
  admin = await cookieFor(ctx.alice, 'admin-tok');
  member = await cookieFor(ctx.bob, 'member-tok');
}, 180_000);
afterAll(async () => {
  await ctx.stop();
});

const call = (method: string, path: string, cookie: string, body?: unknown) =>
  app.request(`/api/${path}`, {
    method,
    headers: { 'content-type': 'application/json', cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const audits = (tool: string) =>
  sql<{ outcome: string }>`select outcome from audit_log where tool = ${tool} order by id`
    .execute(ctx.owner)
    .then((result) => result.rows.map((row) => row.outcome));

interface People {
  people: {
    id: string;
    role: string;
    status: string;
    email?: string;
    devices: { id: string; channel: string }[];
  }[];
}

it('shows the admin everyone with role, status and linked chats, and no web sessions', async () => {
  await ctx.owner
    .updateTable('credentials')
    .set({ must_change: true })
    .where('user_id', '=', ctx.bob.userId)
    .execute();
  const answer = await call('GET', 'admin/people', admin);
  expect(answer.status).toBe(200);
  const { people } = (await answer.json()) as People;
  await ctx.owner
    .updateTable('credentials')
    .set({ must_change: false })
    .where('user_id', '=', ctx.bob.userId)
    .execute();
  const bob = people.find((person) => person.id === ctx.bob.userId);
  expect(people.map((person) => person.role).sort()).toEqual(['admin', 'member']);
  expect(bob).toMatchObject({ email: 'b@example.test', status: 'temporary_password' });
  expect(bob?.devices.map((device) => device.channel)).toEqual(['fake']);
  const alice = people.find((person) => person.id === ctx.alice.userId);
  expect(alice?.devices.map((device) => device.channel)).toEqual(['fake']);
  expect(alice?.status).toBe('active');
});

it('refuses a member and a signed-out caller on every admin page route', async () => {
  expect((await call('GET', 'admin/people', member)).status).toBe(403);
  expect((await call('GET', 'admin/invites', member)).status).toBe(403);
  expect((await call('GET', 'admin/people', '')).status).toBe(401);
});

it('lists open invites only, and revokes an unused one with an audit row', async () => {
  const made = await call('POST', 'invites', admin, { monthlyLimitUsd: 5 });
  const { token } = (await made.json()) as { token: string };
  const listed = await call('GET', 'admin/invites', admin);
  const { invites } = (await listed.json()) as {
    invites: { id: string; monthlyLimitUsd?: number }[];
  };
  const mine = invites.filter((invite) => invite.monthlyLimitUsd === 5);
  expect(mine).toHaveLength(1);
  const id = mine[0]?.id ?? '';
  expect((await call('DELETE', `admin/invites/${id}`, member)).status).toBe(403);
  expect((await call('DELETE', 'admin/invites/not-an-id', admin)).status).toBe(404);
  expect((await call('DELETE', `admin/invites/${id}`, admin)).status).toBe(204);
  expect((await call('DELETE', `admin/invites/${id}`, admin)).status).toBe(404);
  const join = { token, email: 'late@example.test', password: 'a brand new password' };
  expect((await call('POST', 'join', '', { ...join, acceptedNotice: true })).status).toBe(410);
  expect(await audits('admin.invite.revoke')).toEqual(['refused', 'ok', 'refused']);
});

it('keeps a used invite: it cannot be revoked', async () => {
  const made = await call('POST', 'invites', admin, {});
  const { token } = (await made.json()) as { token: string };
  const join = { token, email: 'used@example.test', password: 'a brand new password' };
  expect((await call('POST', 'join', '', { ...join, acceptedNotice: true })).status).toBe(200);
  const row = await ctx.owner
    .selectFrom('invites')
    .select('id')
    .where('token_hash', '=', sha256(token))
    .executeTakeFirstOrThrow();
  expect((await call('DELETE', `admin/invites/${row.id}`, admin)).status).toBe(404);
  const { invites } = (await (await call('GET', 'admin/invites', admin)).json()) as {
    invites: { id: string }[];
  };
  expect(invites.map((invite) => invite.id)).not.toContain(row.id);
});

it('lets the admin unlink a member chat, and audits it', async () => {
  const { people } = (await (await call('GET', 'admin/people', admin)).json()) as People;
  const chat = people.find((person) => person.id === ctx.bob.userId)?.devices[0];
  expect((await call('DELETE', `devices/${chat?.id ?? ''}`, admin)).status).toBe(204);
  expect(await audits('device.unlink')).toEqual(['ok']);
});
