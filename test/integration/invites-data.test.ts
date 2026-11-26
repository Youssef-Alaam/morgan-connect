import { sql } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { adminRead, AdminReadRefused } from '../../src/data/admin-read.js';
import {
  changePassword,
  createAccount,
  createInvite,
  credentialsByEmail,
  inviteLive,
  redeemInvite,
  sessionOwner,
  createSession,
} from '../../src/data/index.js';
import { startIsolation, type Isolation } from '../helpers/isolation.js';

let ctx: Isolation;
beforeAll(async () => {
  ctx = await startIsolation();
}, 180_000);
afterAll(async () => {
  await ctx.stop();
});

const userRow = (email: string) =>
  ctx.owner
    .selectFrom('credentials')
    .innerJoin('users', 'users.id', 'credentials.user_id')
    .select([
      'users.id',
      'users.role',
      'users.workspace_id',
      'users.monthly_limit_usd',
      'users.told_admin_can_read_at',
      'credentials.must_change',
    ])
    .where('email', '=', email)
    .executeTakeFirst();

it('lets only the admin make an invite; the role and limit land on the new member, told at joining', async () => {
  const { app, alice, bob } = ctx;
  expect(
    await createInvite(app, bob, { tokenHash: 'h0', ttlSeconds: 60, monthlyLimitUsd: 1 }),
  ).toBe(false);
  expect(await inviteLive(app, 'h0')).toBe(false);
  const invite = { tokenHash: 'h1', ttlSeconds: 600, monthlyLimitUsd: 12.5 };
  expect(await createInvite(app, alice, invite)).toBe(true);
  expect(await inviteLive(app, 'h1')).toBe(true);
  const joined = await redeemInvite(app, {
    tokenHash: 'h1',
    email: 'New@x.test',
    passwordHash: 'p',
  });
  expect(joined?.workspaceId).toBe(alice.workspaceId);
  expect(await userRow('new@x.test')).toMatchObject({
    role: 'member',
    monthly_limit_usd: '12.50',
    must_change: false,
  });
  expect((await userRow('new@x.test'))?.told_admin_can_read_at).toBeInstanceOf(Date);
  // The invite dies when the account is created.
  expect(await inviteLive(app, 'h1')).toBe(false);
  expect(
    await redeemInvite(app, { tokenHash: 'h1', email: 'b@x.test', passwordHash: 'p' }),
  ).toBeUndefined();
});

it('refuses an expired invite, and a taken email leaves the invite unspent', async () => {
  const { app, alice, owner } = ctx;
  await createInvite(app, alice, { tokenHash: 'h2', ttlSeconds: 600, monthlyLimitUsd: null });
  await sql`update invites set expires_at = now() - interval '1 second' where token_hash = 'h2'`.execute(
    owner,
  );
  expect(await inviteLive(app, 'h2')).toBe(false);
  expect(
    await redeemInvite(app, { tokenHash: 'h2', email: 'e@x.test', passwordHash: 'p' }),
  ).toBeUndefined();
  await createInvite(app, alice, { tokenHash: 'h3', ttlSeconds: 600, monthlyLimitUsd: null });
  await expect(
    redeemInvite(app, { tokenHash: 'h3', email: 'a@example.test', passwordHash: 'p' }),
  ).rejects.toThrow(/duplicate key/);
  expect(await inviteLive(app, 'h3')).toBe(true);
});

it('makes a temporary-password account that must change it, and the notice is recorded then', async () => {
  const { app, alice, bob } = ctx;
  const account = { email: 'Temp@x.test', passwordHash: 'tmp', monthlyLimitUsd: 3 };
  expect(await createAccount(app, bob, account)).toBe(false);
  expect(await credentialsByEmail(app, 'temp@x.test')).toBeUndefined();
  expect(await createAccount(app, alice, account)).toBe(true);
  const made = await userRow('temp@x.test');
  expect(made).toMatchObject({ role: 'member', monthly_limit_usd: '3.00', must_change: true });
  expect(made?.told_admin_can_read_at).toBeNull();
  const me = { userId: made?.id ?? '', workspaceId: made?.workspace_id ?? '' };
  await createSession(app, me, {
    tokenHash: 'tmp-session',
    expiresAt: new Date(Date.now() + 60_000),
  });
  expect((await sessionOwner(app, 'tmp-session'))?.mustChange).toBe(true);
  await changePassword(app, me, { passwordHash: 'new', noticeAccepted: true });
  expect((await sessionOwner(app, 'tmp-session'))?.mustChange).toBe(false);
  expect(await credentialsByEmail(app, 'temp@x.test')).toMatchObject({ passwordHash: 'new' });
  expect((await userRow('temp@x.test'))?.told_admin_can_read_at).toBeInstanceOf(Date);
});

it('has the admin read path refuse a member who was never told, and audit the refusal', async () => {
  const { app, alice, owner } = ctx;
  const stranger = await owner
    .insertInto('users')
    .values({ role: 'member' })
    .returning('id')
    .executeTakeFirstOrThrow();
  await expect(adminRead.chat(app, alice, stranger.id, 'not told')).rejects.toBeInstanceOf(
    AdminReadRefused,
  );
  await expect(adminRead.usage(app, alice, stranger.id, 'not told')).rejects.toBeInstanceOf(
    AdminReadRefused,
  );
  const rows = await owner
    .selectFrom('audit_log')
    .select('outcome')
    .where('reason', '=', 'not told')
    .execute();
  expect(rows).toEqual([{ outcome: 'refused' }, { outcome: 'refused' }]);
  await owner
    .updateTable('users')
    .set({ told_admin_can_read_at: new Date() })
    .where('id', '=', stranger.id)
    .execute();
  expect(await adminRead.chat(app, alice, stranger.id, 'told now')).toEqual([]);
});
