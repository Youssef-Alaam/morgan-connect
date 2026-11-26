import { afterAll, beforeAll, expect, it } from 'vitest';
import { confirmTotp, pendingTotp, startTotp } from '../../src/data/index.js';
import { startIsolation, type Isolation } from '../helpers/isolation.js';

let ctx: Isolation;
beforeAll(async () => {
  ctx = await startIsolation();
}, 180_000);
afterAll(async () => {
  await ctx.stop();
});

const hashesOf = async (userId: string) =>
  (
    await ctx.owner
      .selectFrom('backup_codes')
      .select('code_hash')
      .where('user_id', '=', userId)
      .execute()
  )
    .map((row) => row.code_hash)
    .sort();

it('keeps one pending authenticator per person and replaces it while it is unconfirmed', async () => {
  expect(await startTotp(ctx.app, ctx.alice, 'sealed-1')).toBe(true);
  expect(await pendingTotp(ctx.app, ctx.alice)).toBe('sealed-1');
  expect(await startTotp(ctx.app, ctx.alice, 'sealed-2')).toBe(true);
  expect(await pendingTotp(ctx.app, ctx.alice)).toBe('sealed-2');
});

it('confirms once: it records the step, swaps in the new backup codes and closes the pending slot', async () => {
  const codeHashes = ['x1', 'x2', 'x3'];
  const keepSessionId = (
    await ctx.owner
      .selectFrom('sessions')
      .select('id')
      .where('user_id', '=', ctx.alice.userId)
      .executeTakeFirstOrThrow()
  ).id;
  await ctx.owner
    .insertInto('sessions')
    .values({
      user_id: ctx.alice.userId,
      workspace_id: ctx.alice.workspaceId,
      token_hash: 'extra',
      expires_at: new Date(Date.now() + 60_000),
    })
    .execute();
  const confirm = { sealed: 'sealed-2', step: 77, codeHashes, keepSessionId };
  expect(await confirmTotp(ctx.app, ctx.alice, { ...confirm, sealed: 'sealed-0' })).toBe(false);
  expect(await confirmTotp(ctx.app, ctx.alice, confirm)).toBe(true);
  const kept = await ctx.owner
    .selectFrom('sessions')
    .select('id')
    .where('user_id', '=', ctx.alice.userId)
    .execute();
  expect(kept.map((row) => row.id)).toEqual([keepSessionId]);
  expect(await hashesOf(ctx.alice.userId)).toEqual(codeHashes);
  const factor = await ctx.owner
    .selectFrom('totp_factors')
    .selectAll()
    .where('user_id', '=', ctx.alice.userId)
    .executeTakeFirstOrThrow();
  expect([factor.confirmed_at instanceof Date, factor.last_step]).toEqual([true, '77']);
  expect(await pendingTotp(ctx.app, ctx.alice)).toBeUndefined();
  expect(await confirmTotp(ctx.app, ctx.alice, { ...confirm, step: 78, codeHashes: ['y1'] })).toBe(
    false,
  );
  expect(await hashesOf(ctx.alice.userId)).toEqual(codeHashes);
  expect(await startTotp(ctx.app, ctx.alice, 'sealed-3')).toBe(false);
});

it("never touches another person's authenticator", async () => {
  expect(await pendingTotp(ctx.app, ctx.bob)).toBe('sealed');
  expect(await hashesOf(ctx.bob.userId)).toEqual(['h-b']);
});
