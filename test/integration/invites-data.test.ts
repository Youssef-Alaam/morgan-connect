import { sql } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { adminRead, AdminReadRefused } from '../../src/data/admin-read.js';
import {
  createAccount,
  createInvite,
  createSession,
  credentialsByEmail,
  inviteLive,
  redeemInvite,
  sessionOwner,
  withOwner,
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
    .leftJoin('budgets', 'budgets.user_id', 'users.id')
    .select(['users.id', 'users.role', 'users.workspace_id', 'budgets.monthly_limit_usd'])
    .select(['users.told_admin_can_read_at', 'credentials.must_change'])
    .where('email', '=', email)
    .executeTakeFirst();
const invite = (token: string, limit: number | null = null, by = ctx.alice) =>
  createInvite(ctx.app, by, { tokenHash: token, ttlSeconds: 600, monthlyLimitUsd: limit });
const spend = (token: string, email: string) =>
  redeemInvite(ctx.app, { tokenHash: token, email, passwordHash: 'p' });

it('lets only the admin make an invite; role and limit land on the new member, told at joining', async () => {
  expect(await invite('h0', 1, ctx.bob)).toBe(false);
  expect(await inviteLive(ctx.app, 'h0')).toBe(false);
  expect(await invite('h1', 12.5)).toBe(true);
  expect(await inviteLive(ctx.app, 'h1')).toBe(true);
  expect((await spend('h1', 'New@x.test'))?.workspaceId).toBe(ctx.alice.workspaceId);
  const made = await userRow('new@x.test');
  expect(made).toMatchObject({
    role: 'member',
    monthly_limit_usd: '12.50000000',
    must_change: false,
  });
  expect(made?.told_admin_can_read_at).toBeInstanceOf(Date);
  // The invite dies when the account is created.
  expect(await inviteLive(ctx.app, 'h1')).toBe(false);
  expect(await spend('h1', 'b@x.test')).toBeUndefined();
});

it('refuses an expired invite, and a taken email leaves the invite unspent', async () => {
  await invite('h2');
  await sql`update invites set expires_at = now() - interval '1 second' where token_hash = 'h2'`.execute(
    ctx.owner,
  );
  expect(await inviteLive(ctx.app, 'h2')).toBe(false);
  expect(await spend('h2', 'e@x.test')).toBeUndefined();
  await invite('h3');
  await expect(spend('h3', 'a@example.test')).rejects.toThrow(/duplicate key/);
  expect(await inviteLive(ctx.app, 'h3')).toBe(true);
});

it('lets two people spend one invite at once only once', async () => {
  await invite('race');
  const results = await Promise.all([spend('race', 'r1@x.test'), spend('race', 'r2@x.test')]);
  expect(results.filter((r) => r !== undefined)).toHaveLength(1);
});

it('makes a temporary-password account that must change it, and the notice is recorded then', async () => {
  const { app, alice, bob } = ctx;
  const account = { email: 'Temp@x.test', passwordHash: 'tmp', monthlyLimitUsd: 3 };
  expect(await createAccount(app, bob, account)).toBeUndefined();
  expect(await credentialsByEmail(app, 'temp@x.test')).toBeUndefined();
  const id = await createAccount(app, alice, account);
  const made = await userRow('temp@x.test');
  expect(made).toMatchObject({
    id,
    role: 'member',
    monthly_limit_usd: '3.00000000',
    must_change: true,
  });
  expect(made?.told_admin_can_read_at).toBeNull();
  const me = { userId: made?.id ?? '', workspaceId: made?.workspace_id ?? '' };
  const expiresAt = new Date(Date.now() + 60_000);
  await createSession(app, me, { tokenHash: 'tmp-session', expiresAt });
  expect((await sessionOwner(app, 'tmp-session'))?.mustChange).toBe(true);
  await withOwner(app, me, (trx) => sql`select member_accept_notice()`.execute(trx));
  expect((await userRow('temp@x.test'))?.told_admin_can_read_at).toBeInstanceOf(Date);
});

it('has the admin read path refuse a member who was never told, and audit the refusal', async () => {
  const { app, alice, owner } = ctx;
  const stranger = await owner
    .insertInto('users')
    .values({ role: 'member' })
    .returning('id')
    .executeTakeFirstOrThrow();
  const refused = AdminReadRefused;
  await expect(adminRead.chat(app, alice, stranger.id, 'not told')).rejects.toBeInstanceOf(refused);
  await expect(adminRead.usage(app, alice, stranger.id, 'not told')).rejects.toBeInstanceOf(
    refused,
  );
  const rows = await owner
    .selectFrom('audit_log')
    .select('outcome')
    .where('reason', '=', 'not told')
    .execute();
  expect(rows).toEqual([{ outcome: 'refused' }, { outcome: 'refused' }]);
  const told = { told_admin_can_read_at: new Date() };
  await owner.updateTable('users').set(told).where('id', '=', stranger.id).execute();
  expect(await adminRead.chat(app, alice, stranger.id, 'told now')).toEqual([]);
});

it('keeps the app role from changing a user row or a spent invite', async () => {
  const { app, bob, alice } = ctx;
  const promote = withOwner(app, bob, (trx) =>
    trx.updateTable('users').set({ role: 'admin' }).where('id', '=', bob.userId).execute(),
  );
  await expect(promote).rejects.toThrow(/permission denied/);
  const rearm = withOwner(app, alice, (trx) =>
    trx.updateTable('invites').set({ used_at: null }).execute(),
  );
  await expect(rearm).rejects.toThrow(/permission denied/);
});
