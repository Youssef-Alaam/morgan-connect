import { sql } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createSession, type Owner } from '../../src/data/index.js';
import { createApp } from '../../src/http/index.js';
import { sha256 } from '../../src/identity/admin-link.js';
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
const call = (method: string, path: string, cookie: string, body?: unknown) =>
  app.request(`/api/${path}`, {
    method,
    headers: { 'content-type': 'application/json', cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const set = async (who: Owner, body: unknown) =>
  call('PUT', `members/${ctx.bob.userId}/profile`, await cookieFor(who), body);

interface Shown {
  person: { preset: string; shellGate: string; modes: Record<string, string> };
  devices: {
    deviceId: string;
    channel: string;
    preset: string;
    own: boolean;
    modes: Record<string, string>;
  }[];
}

it('the admin sets a person and one device, and the API shows what applies to each device', async () => {
  const person = await set(ctx.alice, { preset: 'trusted' });
  expect(person.status).toBe(200);
  expect(await person.json()).toMatchObject({
    previous: 'standard',
    preset: 'trusted',
    warnings: [{ actionType: 'create', warning: 'profile.risk.create.auto' }],
  });
  const device = await ctx.owner
    .selectFrom('devices')
    .select('id')
    .where('user_id', '=', ctx.bob.userId)
    .executeTakeFirstOrThrow();
  const tighter = await set(ctx.alice, { preset: 'restricted', deviceId: device.id });
  expect(await tighter.json()).toMatchObject({
    previous: 'trusted',
    preset: 'restricted',
    warnings: [],
  });
  const shown = (await (
    await call('GET', `members/${ctx.bob.userId}/profiles`, await cookieFor(ctx.alice))
  ).json()) as Shown;
  expect(shown.person).toMatchObject({ preset: 'trusted', shellGate: 'risky_only' });
  expect(shown.devices).toEqual([
    expect.objectContaining({ deviceId: device.id, preset: 'restricted', own: true }),
  ]);
  expect(shown.devices[0]?.modes).toMatchObject({ read: 'auto', send: 'off' });
});

it('a member reads their own profiles but not another person’s, and cannot set any', async () => {
  const cookie = await cookieFor(ctx.bob);
  expect((await call('GET', `members/${ctx.bob.userId}/profiles`, cookie)).status).toBe(200);
  expect((await call('GET', `members/${ctx.alice.userId}/profiles`, cookie)).status).toBe(404);
  const refused = await call('PUT', `members/${ctx.bob.userId}/profile`, cookie, {
    preset: 'trusted',
  });
  expect(refused.status).toBe(403);
  const { rows } = await sql<{ n: string }>`
    select count(*) as n from audit_log
    where tool = 'admin.profile.assign' and outcome = 'refused' and user_id = ${ctx.bob.userId}`.execute(
    ctx.owner,
  );
  expect(rows[0]?.n).toBe('1');
});

it('refuses a bad id or preset, and a call without a session', async () => {
  const cookie = await cookieFor(ctx.alice);
  expect(
    (await call('PUT', `members/${ctx.bob.userId}/profile`, cookie, { preset: 'root' })).status,
  ).toBe(400);
  expect((await call('PUT', 'members/nope/profile', cookie, { preset: 'trusted' })).status).toBe(
    400,
  );
  expect((await call('GET', 'members/nope/profiles', cookie)).status).toBe(404);
  expect((await call('GET', `members/${ctx.bob.userId}/profiles`, '')).status).toBe(401);
});

it('refuses the admin setting their own profile to restricted, with a refused audit row', async () => {
  const cookie = await cookieFor(ctx.alice);
  const own = `members/${ctx.alice.userId}/profile`;
  expect((await call('PUT', own, cookie, { preset: 'restricted' })).status).toBe(403);
  const { rows } = await sql<{ n: string }>`
    select count(*) as n from audit_log
    where tool = 'admin.profile.assign' and outcome = 'refused' and user_id = ${ctx.alice.userId}
      and subject_user_id = ${ctx.alice.userId} and reason = 'restricted for person'`.execute(
    ctx.owner,
  );
  expect(rows[0]?.n).toBe('1');
  expect((await call('PUT', own, cookie, { preset: 'trusted' })).status).toBe(200);
});

interface Preview {
  previous: string;
  preset: string;
  warnings: { actionType: string; from: string; to: string; warning: string }[];
  refused: boolean;
}
const preview = async (who: Owner, query: string) =>
  call('GET', `admin/profile-preview?${query}`, await cookieFor(who));

it('lists the three presets with what each allows, for the admin only', async () => {
  const shown = await call('GET', 'admin/profile-presets', await cookieFor(ctx.alice));
  expect(shown.status).toBe(200);
  const { presets } = (await shown.json()) as {
    presets: { preset: string; shellGate: string; modes: Record<string, string> }[];
  };
  expect(presets.map((row) => row.preset)).toEqual(['restricted', 'standard', 'trusted']);
  expect(presets[0]?.modes).toMatchObject({ read: 'auto', send: 'off' });
  expect(presets[2]?.shellGate).toBe('risky_only');
  expect((await call('GET', 'admin/profile-presets', await cookieFor(ctx.bob))).status).toBe(403);
  expect((await call('GET', 'admin/profile-presets', '')).status).toBe(401);
});

it('previews the risk warnings of a choice without saving it or writing an audit row', async () => {
  await set(ctx.alice, { preset: 'standard' });
  const before = await sql<{ n: string }>`select count(*) as n from audit_log`.execute(ctx.owner);
  const loosen = await preview(ctx.alice, `userId=${ctx.bob.userId}&preset=trusted`);
  expect(loosen.status).toBe(200);
  expect((await loosen.json()) as Preview).toMatchObject({
    previous: 'standard',
    preset: 'trusted',
    warnings: [{ actionType: 'create', warning: 'profile.risk.create.auto' }],
  });
  const tighten = await preview(ctx.alice, `userId=${ctx.bob.userId}&preset=restricted`);
  expect(((await tighten.json()) as Preview).warnings).toEqual([]);
  const after = await sql<{ n: string }>`select count(*) as n from audit_log`.execute(ctx.owner);
  expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  const shown = (await (
    await call('GET', `members/${ctx.bob.userId}/profiles`, await cookieFor(ctx.alice))
  ).json()) as Shown;
  expect(shown.person.preset).toBe('standard');
});

it('previews for one device, and refuses a member, a stranger device and bad input', async () => {
  const device = await ctx.owner
    .selectFrom('devices')
    .select('id')
    .where('user_id', '=', ctx.bob.userId)
    .executeTakeFirstOrThrow();
  const ok = await preview(
    ctx.alice,
    `userId=${ctx.bob.userId}&deviceId=${device.id}&preset=trusted`,
  );
  expect(ok.status).toBe(200);
  const other = await preview(
    ctx.alice,
    `userId=${ctx.alice.userId}&deviceId=${device.id}&preset=trusted`,
  );
  expect(other.status).toBe(404);
  expect((await preview(ctx.bob, `userId=${ctx.bob.userId}&preset=trusted`)).status).toBe(403);
  expect((await preview(ctx.alice, `userId=${ctx.bob.userId}&preset=root`)).status).toBe(400);
  expect((await preview(ctx.alice, `userId=nope&preset=trusted`)).status).toBe(400);
});

it('flags a preview the save would refuse: the admin making themselves Restricted', async () => {
  const own = await preview(ctx.alice, `userId=${ctx.alice.userId}&preset=restricted`);
  expect(((await own.json()) as Preview).refused).toBe(true);
  const theirs = await preview(ctx.alice, `userId=${ctx.bob.userId}&preset=restricted`);
  expect(((await theirs.json()) as Preview).refused).toBe(false);
});

it('does not preview a person in another workspace', async () => {
  const stranger = await ctx.owner
    .insertInto('users')
    .values({ workspace_id: ctx.otherWorkspaceId, role: 'member' })
    .returning('id')
    .executeTakeFirstOrThrow();
  expect((await preview(ctx.alice, `userId=${stranger.id}&preset=trusted`)).status).toBe(404);
});

it('the preview flag equals the save outcome for the admin�s own device', async () => {
  const device = await ctx.owner
    .selectFrom('devices')
    .select('id')
    .where('user_id', '=', ctx.alice.userId)
    .where('channel', '<>', 'web')
    .executeTakeFirstOrThrow();
  const shown = await preview(
    ctx.alice,
    `userId=${ctx.alice.userId}&deviceId=${device.id}&preset=restricted`,
  );
  expect(((await shown.json()) as Preview).refused).toBe(true);
  const saved = await call(
    'PUT',
    `members/${ctx.alice.userId}/profile`,
    await cookieFor(ctx.alice),
    {
      preset: 'restricted',
      deviceId: device.id,
    },
  );
  expect(saved.status).toBe(403);
});
