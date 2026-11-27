import { sql } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createSession, type Owner } from '../../src/data/index.js';
import { createApp } from '../../src/http/index.js';
import { sha256 } from '../../src/identity/admin-link.js';
import { createLogger } from '../../src/ops/index.js';
import { startIsolation, type Isolation } from '../helpers/isolation.js';

// The audit log viewer and the member chat view (M2-15d), through the real routes.
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
interface Page {
  rows: { id: string; person: string | null; actionType: string; outcome: string }[];
  more: boolean;
  actions: string[];
}
const list = async (query: string, cookie = admin): Promise<Page> =>
  (await (await call('GET', `admin/audit?${query}`, cookie)).json()) as Page;
const count = async (tool: string, outcome: string): Promise<number> => {
  const { rows } = await sql<{ n: string }>`select count(*) as n from audit_log
    where tool = ${tool} and outcome = ${outcome}`.execute(ctx.owner);
  return Number(rows[0]?.n);
};
const seed = async (who: Owner, n: number, action: string, outcome = 'ok') => {
  await ctx.owner
    .insertInto('audit_log')
    .values(
      Array.from({ length: n }, () => ({
        user_id: who.userId,
        workspace_id: who.workspaceId,
        channel: 'fake',
        chat_id: 'x',
        tool: action,
        action_type: action,
        changes_state: false,
        arg_names: [],
        extra_args: 0,
        args_sha256: 'h',
        decision: 'auto' as const,
        outcome: outcome as 'ok',
      })),
    )
    .execute();
};

it('shows the admin every person rows with the action types, and filters them', async () => {
  await seed(ctx.alice, 2, 'bulk.a');
  await seed(ctx.bob, 3, 'bulk.b', 'refused');
  const all = await list('');
  expect(all.actions).toEqual(expect.arrayContaining(['bulk.a', 'bulk.b', 'read']));
  const bob = await list('action=bulk.b&person=' + ctx.bob.userId);
  expect(bob.rows).toHaveLength(3);
  expect(bob.rows[0]).toMatchObject({ person: 'b@example.test', outcome: 'refused' });
  expect((await list('action=bulk.a&outcome=refused')).rows).toEqual([]);
  expect((await list('decision=ask&action=bulk.a')).rows).toEqual([]);
  expect((await list('action=bulk.a&from=2999-01-01T00:00:00Z')).rows).toEqual([]);
  expect((await list('action=bulk.a&to=2000-01-01T00:00:00Z')).rows).toEqual([]);
  expect((await list('action=bulk.a&from=2000-01-01&to=2999-01-01')).rows).toHaveLength(2);
});

it('pages a large log with no row twice and none missed, even as new rows arrive', async () => {
  await seed(ctx.alice, 130, 'page.test');
  const seen: string[] = [];
  let before = '';
  for (let pages = 0; pages < 10; pages += 1) {
    const page = await list(`action=page.test&limit=50${before}`);
    seen.push(...page.rows.map((row) => row.id));
    if (pages === 0) await seed(ctx.alice, 5, 'page.test');
    if (!page.more) break;
    before = `&before=${page.rows.at(-1)?.id ?? ''}`;
  }
  expect(seen).toHaveLength(130);
  expect(new Set(seen).size).toBe(130);
  expect(seen).toEqual([...seen].sort((a, b) => Number(b) - Number(a)));
});

it('refuses a member and a signed-out caller, and audits the refusal', async () => {
  expect((await call('GET', 'admin/audit', member)).status).toBe(403);
  expect((await call('GET', 'admin/audit?person=nope', member)).status).toBe(403);
  expect((await call('GET', 'admin/audit', '')).status).toBe(401);
  expect(await count('admin.audit.list', 'refused')).toBe(1);
  expect((await call('GET', 'admin/audit?person=nope', admin)).status).toBe(400);
});

it('has no route that changes or removes an audit row', async () => {
  const before = await sql`select count(*) from audit_log`.execute(ctx.owner);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const path of ['admin/audit', 'admin/audit/1']) {
      expect((await call(method, path, admin, {})).status).toBe(404);
    }
  }
  expect(await sql`select count(*) from audit_log`.execute(ctx.owner)).toEqual(before);
});

it('opens a member chat only after one admin.read row, which then tops the log', async () => {
  const before = await count('admin.read.chat', 'ok');
  const answer = await call('POST', `admin/people/${ctx.bob.userId}/chat`, admin, {
    reason: 'support ticket 12',
  });
  expect(answer.status).toBe(200);
  const { messages } = (await answer.json()) as { messages: { text: string }[] };
  expect(messages).toMatchObject([{ text: 'hi' }]);
  expect(await count('admin.read.chat', 'ok')).toBe(before + 1);
  const top = (await list('limit=1')).rows[0];
  expect(top).toMatchObject({ actionType: 'admin.read', outcome: 'ok', person: 'a@example.test' });
});

it('refuses a member, a blank reason and a stranger on the chat view', async () => {
  const path = `admin/people/${ctx.alice.userId}/chat`;
  const refused = await count('admin.read.chat', 'refused');
  expect((await call('POST', path, member, { reason: 'curious' })).status).toBe(403);
  expect(await count('admin.read.chat', 'refused')).toBe(refused + 1);
  expect((await call('POST', `admin/people/${ctx.bob.userId}/chat`, admin, {})).status).toBe(400);
  const gone = '99999999-9999-4999-8999-999999999999';
  expect((await call('POST', `admin/people/${gone}/chat`, admin, { reason: 'x' })).status).toBe(
    404,
  );
  expect(await count('admin.read.chat', 'refused')).toBe(refused + 2);
});
