import { sql } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { assignedTo, assignPreset, listPresets, withOwner } from '../../src/data/index.js';
import { startIsolation, type Isolation } from '../helpers/isolation.js';

let ctx: Isolation;
beforeAll(async () => {
  ctx = await startIsolation();
  await ctx.owner
    .insertInto('devices')
    .values({ user_id: ctx.bob.userId, channel: 'telegram', chat_id: 'tg' })
    .execute();
}, 180_000);
afterAll(async () => {
  await ctx.stop();
});

const bobsDevice = () =>
  ctx.owner
    .selectFrom('devices')
    .select('id')
    .where('user_id', '=', ctx.bob.userId)
    .where('channel', '=', 'telegram')
    .executeTakeFirstOrThrow()
    .then((row) => row.id);

it('stores three presets, each with a shell-gate level, which the app role cannot change', async () => {
  const presets = await listPresets(ctx.app);
  expect(presets.map((row) => [row.preset, row.shellGate])).toEqual([
    ['restricted', 'risky_only'],
    ['standard', 'risky_only'],
    ['trusted', 'risky_only'],
  ]);
  const edit = sql`update access_profiles set modes = '{}'::jsonb`.execute(ctx.app);
  await expect(edit).rejects.toThrow(/permission denied/);
});

it('lets the admin set a person and a device, and says what was there before', async () => {
  const person = { userId: ctx.bob.userId, preset: 'trusted' };
  expect(await assignPreset(ctx.app, ctx.alice, person)).toEqual({
    role: 'member',
    personPreset: 'standard',
    devicePreset: undefined,
  });
  const deviceId = await bobsDevice();
  await assignPreset(ctx.app, ctx.alice, { ...person, deviceId, preset: 'restricted' });
  const chat = { channel: 'telegram', chatId: 'tg' };
  expect(await assignedTo(ctx.app, ctx.bob, chat)).toEqual({
    role: 'member',
    personPreset: 'trusted',
    devicePreset: 'restricted',
  });
  expect((await assignedTo(ctx.app, ctx.bob, undefined)).devicePreset).toBeUndefined();
  await ctx.owner.deleteFrom('devices').where('id', '=', deviceId).execute();
  const left = await ctx.owner
    .selectFrom('profile_assignments')
    .select('id')
    .where('device_id', '=', deviceId)
    .execute();
  expect(left).toEqual([]);
});

it('writes an audit row for a change and for a refused one', async () => {
  const trail = (outcome: string) =>
    sql<{ user_id: string; subject_user_id: string; reason: string }>`
      select user_id, subject_user_id, reason from audit_log
      where tool = 'admin.profile.assign' and outcome = ${outcome}`.execute(ctx.owner);
  expect((await trail('ok')).rows).toContainEqual({
    user_id: ctx.alice.userId,
    subject_user_id: ctx.bob.userId,
    reason: 'trusted for person',
  });
  const own = { userId: ctx.bob.userId, preset: 'trusted' };
  expect(await assignPreset(ctx.app, ctx.bob, own)).toBeUndefined();
  expect((await trail('refused')).rows).toEqual([
    { user_id: ctx.bob.userId, subject_user_id: ctx.bob.userId, reason: 'trusted for person' },
  ]);
});

it('refuses a device that is not the person’s, and a member writing straight to the table', async () => {
  const alicesDevice = await ctx.owner
    .selectFrom('devices')
    .select('id')
    .where('user_id', '=', ctx.alice.userId)
    .executeTakeFirstOrThrow();
  const wrong = { userId: ctx.bob.userId, deviceId: alicesDevice.id, preset: 'trusted' };
  expect(await assignPreset(ctx.app, ctx.alice, wrong)).toBeUndefined();
  const self = withOwner(ctx.app, ctx.bob, (trx) =>
    trx
      .insertInto('profile_assignments')
      .values({ user_id: ctx.bob.userId, workspace_id: ctx.bob.workspaceId, preset: 'trusted' })
      .execute(),
  );
  await expect(self).rejects.toThrow(/row-level security/);
});
