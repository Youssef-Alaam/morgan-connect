import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assignProfile, PRESETS, profileFor, type Preset } from '../../src/policy/index.js';
import type { Mode } from '../../src/policy/profile.js';
import type { ActionType } from '../../src/tools/index.js';
import { startIsolation, type Isolation } from '../helpers/isolation.js';

// The table the owner signs (M2-9a): a mode for every (preset, action type). A new action type
// with no row here is a compile error.
const EXPECTED = {
  restricted: {
    read: 'auto',
    create: 'off',
    overwrite: 'off',
    delete: 'off',
    send: 'off',
    execute: 'off',
  },
  standard: {
    read: 'auto',
    create: 'ask',
    overwrite: 'ask',
    delete: 'ask',
    send: 'ask',
    execute: 'ask',
  },
  trusted: {
    read: 'auto',
    create: 'auto',
    overwrite: 'ask',
    delete: 'ask',
    send: 'ask',
    execute: 'ask',
  },
} as const satisfies Record<Preset, Record<ActionType, Mode>>;

const KINDS = ['telegram', 'web'] as const;
const TYPES = Object.keys(EXPECTED.restricted) as ActionType[];

let ctx: Isolation;
beforeAll(async () => {
  ctx = await startIsolation();
  const devices = KINDS.map((channel) => ({
    user_id: ctx.bob.userId,
    channel,
    chat_id: `d-${channel}`,
  }));
  await ctx.owner.insertInto('devices').values(devices).execute();
}, 180_000);
afterAll(async () => {
  await ctx.stop();
});

const bobsDevice = (channel: string) => ({ channel, chatId: `d-${channel}` });
const deviceId = async (channel: string): Promise<string> =>
  (
    await ctx.owner
      .selectFrom('devices')
      .select('id')
      .where('user_id', '=', ctx.bob.userId)
      .where('channel', '=', channel)
      .executeTakeFirstOrThrow()
  ).id;
/** A web session's device cannot have its own choice, so on web the person's is what applies. */
const assign = (preset: Preset, channel?: string) =>
  channel === undefined || channel === 'web'
    ? assignProfile(ctx.app, ctx.alice, { userId: ctx.bob.userId, preset })
    : deviceId(channel).then((id) =>
        assignProfile(ctx.app, ctx.alice, { userId: ctx.bob.userId, deviceId: id, preset }),
      );

describe.each(PRESETS.flatMap((preset) => KINDS.map((kind) => [preset, kind] as const)))(
  'preset %s on a %s device',
  (preset, kind) => {
    beforeAll(async () => {
      await assign(preset, kind);
    });
    it.each(TYPES)('decides %s', async (type) => {
      const profile = await profileFor(ctx.app, ctx.bob, bobsDevice(kind));
      expect(profile.preset).toBe(preset);
      expect(profile.modes[type]).toBe(EXPECTED[preset][type]);
    });
    it('carries the shell-gate level, risky-only by default', async () => {
      expect((await profileFor(ctx.app, ctx.bob, bobsDevice(kind))).shellGate).toBe('risky_only');
    });
  },
);

it('lets a device profile override the person, and a device with none take the person', async () => {
  await ctx.owner.deleteFrom('profile_assignments').where('device_id', 'is not', null).execute();
  await assign('trusted');
  await assign('restricted', 'telegram');
  expect((await profileFor(ctx.app, ctx.bob, bobsDevice('telegram'))).preset).toBe('restricted');
  expect((await profileFor(ctx.app, ctx.bob, bobsDevice('web'))).preset).toBe('trusted');
  expect((await profileFor(ctx.app, ctx.bob)).preset).toBe('trusted');
});

it('starts a person nobody assigned as Restricted when they are a member', async () => {
  const carol = await ctx.owner
    .insertInto('users')
    .values({ role: 'member', told_admin_can_read_at: new Date() })
    .returning(['id', 'workspace_id'])
    .executeTakeFirstOrThrow();
  const owner = { userId: carol.id, workspaceId: carol.workspace_id };
  const profile = await profileFor(ctx.app, owner);
  expect(profile).toMatchObject({ preset: 'restricted', modes: EXPECTED.restricted });
});

it('returns a risk warning for every type a grant loosens, and none when it tightens', async () => {
  await assign('restricted');
  const loosening = await assign('trusted');
  expect(loosening?.previous).toBe('restricted');
  expect(loosening?.warnings.map((w) => w.warning)).toEqual([
    'profile.risk.create.auto',
    'profile.risk.overwrite.ask',
    'profile.risk.delete.ask',
    'profile.risk.send.ask',
    'profile.risk.execute.ask',
  ]);
  expect((await assign('standard'))?.warnings).toEqual([]);
});

it('refuses an admin setting their own profile to Restricted, so they cannot lock themselves out', async () => {
  const own = { userId: ctx.alice.userId, preset: 'restricted' } as const;
  expect(await assignProfile(ctx.app, ctx.alice, own)).toBeUndefined();
  expect((await profileFor(ctx.app, ctx.alice)).preset).toBe('standard');
  expect(await assignProfile(ctx.app, ctx.alice, { ...own, preset: 'trusted' })).toBeDefined();
});
