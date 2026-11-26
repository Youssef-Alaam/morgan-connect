import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  accountOf,
  createSession,
  credentialsByEmail,
  endSession,
  issueAdminLink,
  linkLive,
  redeemLink,
  sessionOwner,
  withOwner,
} from '../../src/data/index.js';
import { startIsolation, type Isolation } from '../helpers/isolation.js';

let ctx: Isolation;
beforeAll(async () => {
  ctx = await startIsolation();
  await ctx.owner.deleteFrom('credentials').execute();
  await ctx.owner.deleteFrom('password_links').execute();
}, 180_000);
afterAll(async () => {
  await ctx.stop();
});

it('issues the admin a link once, redeems it once, then needs no more', async () => {
  const { app, alice } = ctx;
  expect(await issueAdminLink(app, 'link-1', 600)).toBe(true);
  expect(await issueAdminLink(app, 'link-2', 600)).toBe(true);
  const login = { email: 'Admin@Example.test', passwordHash: 'hash' };
  expect(await linkLive(app, 'link-2')).toBe(true);
  expect(await redeemLink(app, { tokenHash: 'link-1', ...login })).toBeUndefined();
  expect(await redeemLink(app, { tokenHash: 'link-2', ...login })).toEqual(alice);
  expect(await redeemLink(app, { tokenHash: 'link-2', ...login })).toBeUndefined();
  expect(await issueAdminLink(app, 'link-3', 600)).toBe(false);
  expect(await credentialsByEmail(app, 'ADMIN@example.test')).toEqual({
    ...alice,
    passwordHash: 'hash',
  });
});

it('refuses an expired link and keeps the link when the email is taken', async () => {
  const { app, owner, bob } = ctx;
  await owner
    .insertInto('password_links')
    .values({
      ...ids(bob),
      token_hash: 'old',
      expires_at: new Date(Date.now() - 1000),
      used_at: null,
    })
    .execute();
  const login = { email: 'bob@example.test', passwordHash: 'hash' };
  expect(await redeemLink(app, { tokenHash: 'old', ...login })).toBeUndefined();
  await owner
    .insertInto('password_links')
    .values({
      ...ids(bob),
      token_hash: 'live',
      expires_at: new Date(Date.now() + 60_000),
      used_at: null,
    })
    .execute();
  await expect(
    redeemLink(app, { tokenHash: 'live', ...login, email: 'admin@example.test' }),
  ).rejects.toThrow(/duplicate key/);
  expect(await redeemLink(app, { tokenHash: 'live', ...login })).toEqual(bob);
});

const ids = (who: { userId: string; workspaceId: string }) => ({
  user_id: who.userId,
  workspace_id: who.workspaceId,
});

it('opens a session with a web device, finds it by hash, and ends both', async () => {
  const { app, bob } = ctx;
  const id = await createSession(app, bob, {
    tokenHash: 'tok',
    expiresAt: new Date(Date.now() + 60_000),
  });
  expect(await sessionOwner(app, 'tok')).toEqual({ ...bob, sessionId: id });
  const devices = await withOwner(app, bob, (trx) =>
    trx.selectFrom('devices').select('channel').where('chat_id', '=', id).execute(),
  );
  expect(devices).toEqual([{ channel: 'web' }]);
  expect(await accountOf(app, bob)).toMatchObject({
    user: { id: bob.userId, role: 'member', email: 'bob@example.test' },
    workspace: { id: bob.workspaceId, name: 'Default' },
  });
  await endSession(app, bob, id);
  expect(await sessionOwner(app, 'tok')).toBeUndefined();
});

it('does not find an expired session, and sweeps it at the next sign-in', async () => {
  const { app, owner, bob } = ctx;
  const old = await createSession(app, bob, {
    tokenHash: 'stale',
    expiresAt: new Date(Date.now() + 50),
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(await sessionOwner(app, 'stale')).toBeUndefined();
  await createSession(app, bob, { tokenHash: 'fresh', expiresAt: new Date(Date.now() + 60_000) });
  const left = await owner.selectFrom('devices').select('id').where('chat_id', '=', old).execute();
  expect(left).toEqual([]);
});
