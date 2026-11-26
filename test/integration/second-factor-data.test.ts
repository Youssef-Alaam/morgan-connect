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
  expect(await confirmTotp(ctx.app, ctx.alice, { step: 77, codeHashes })).toBe(true);
  expect(await hashesOf(ctx.alice.userId)).toEqual(codeHashes);
  const factor = await ctx.owner
    .selectFrom('totp_factors')
    .selectAll()
    .where('user_id', '=', ctx.alice.userId)
    .executeTakeFirstOrThrow();
  expect([factor.confirmed_at instanceof Date, factor.last_step]).toEqual([true, '77']);
  expect(await pendingTotp(ctx.app, ctx.alice)).toBeUndefined();
  expect(await confirmTotp(ctx.app, ctx.alice, { step: 78, codeHashes: ['y1'] })).toBe(false);
  expect(await hashesOf(ctx.alice.userId)).toEqual(codeHashes);
  expect(await startTotp(ctx.app, ctx.alice, 'sealed-3')).toBe(false);
});

it("never touches another person's authenticator", async () => {
  expect(await pendingTotp(ctx.app, ctx.bob)).toBe('sealed');
  expect(await hashesOf(ctx.bob.userId)).toEqual(['h-b']);
});
