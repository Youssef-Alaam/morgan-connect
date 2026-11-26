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
