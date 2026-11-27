import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  cancelTopup,
  openTopupFor,
  requestTopup,
  resolveTopup,
  topupTotal,
  type NewTopup,
} from '../../src/data/index.js';
import { startIsolation, type Isolation } from '../helpers/isolation.js';

// The data functions as the app role: who may open, see and answer a top-up request.
let ctx: Isolation;
beforeAll(async () => {
  ctx = await startIsolation();
  await ctx.owner.deleteFrom('budget_topups').execute();
}, 180_000);
afterAll(async () => {
  await ctx.stop();
});

const now = new Date();
const ask = (extra: Partial<NewTopup> = {}): NewTopup => ({
  amountUsd: '5.00000000',
  month: '2026-11',
  channel: 'fake',
  chatId: 'b',
  adminChannel: 'fake',
  now,
  expiresAt: new Date(now.getTime() + 60_000),
  argsSha256: 'hash',
  ...extra,
});
const status = (id: string) =>
  ctx.owner.selectFrom('budget_topups').select('status').where('id', '=', id).executeTakeFirst();

it('opens one request per person with the admin asked in the same step, and audits it', async () => {
  const made = await requestTopup(ctx.app, ctx.bob, ask());
  if (made.outcome !== 'created') throw new Error('expected a request');
  expect(made.adminChatId).toBe('a');
  expect(made.who).toBe('b@example.test');
  expect(await requestTopup(ctx.app, ctx.bob, ask())).toEqual({ outcome: 'open' });
  const approval = await ctx.owner
    .selectFrom('approvals')
    .select(['user_id', 'tool', 'args_sha256'])
    .where('id', '=', made.approvalId)
    .executeTakeFirstOrThrow();
  expect(approval).toEqual({
    user_id: ctx.alice.userId,
    tool: 'budget.topup',
    args_sha256: 'hash',
  });
  const audit = await ctx.owner
    .selectFrom('audit_log')
    .select(['outcome', 'subject_user_id'])
    .where('tool', '=', 'budget.topup.request')
    .execute();
  expect(audit).toEqual([{ outcome: 'ok', subject_user_id: ctx.bob.userId }]);
  expect(await cancelTopup(ctx.app, ctx.alice, made.topupId)).toBe(false);
  expect(await cancelTopup(ctx.app, ctx.bob, made.topupId)).toBe(true);
  expect(await status(made.topupId)).toEqual({ status: 'cancelled' });
  const closed = await ctx.owner
    .selectFrom('audit_log')
    .select(['outcome', 'user_id'])
    .where('tool', '=', 'budget.topup.cancel')
    .execute();
  expect(closed).toEqual([{ outcome: 'aborted', user_id: ctx.bob.userId }]);
});

it('lets a lapsed request be replaced, and refuses the admin asking and a missing admin chat', async () => {
  const first = await requestTopup(ctx.app, ctx.bob, ask());
  const later = new Date(now.getTime() + 61_000);
  const second = await requestTopup(ctx.app, ctx.bob, ask({ now: later }));
  expect([first.outcome, second.outcome]).toEqual(['created', 'created']);
  if (first.outcome !== 'created') return;
  expect(await status(first.topupId)).toEqual({ status: 'expired' });
  expect(await requestTopup(ctx.app, ctx.alice, ask())).toEqual({ outcome: 'unavailable' });
  expect(await requestTopup(ctx.app, ctx.bob, ask({ adminChannel: 'none' }))).toEqual({
    outcome: 'no_admin',
  });
  await ctx.owner.deleteFrom('budget_topups').execute();
});

it('shows the open request only to the admin, who answers it once and it counts only when approved', async () => {
  const made = await requestTopup(ctx.app, ctx.bob, ask());
  if (made.outcome !== 'created') throw new Error('expected a request');
  expect(await openTopupFor(ctx.app, ctx.bob, made.approvalId)).toBeUndefined();
  const open = await openTopupFor(ctx.app, ctx.alice, made.approvalId);
  expect(open).toMatchObject({
    memberId: ctx.bob.userId,
    amountUsd: '5.00000000',
    month: '2026-11',
  });
  expect(await resolveTopup(ctx.app, ctx.bob, made.topupId, 'approved')).toBeUndefined();
  // Not before the admin's approval is spent: the question still pending is not an answer.
  expect(await resolveTopup(ctx.app, ctx.alice, made.topupId, 'approved')).toBeUndefined();
  await ctx.owner.updateTable('approvals').set({ status: 'used' }).execute();
  const before = await topupTotal(ctx.app, ctx.bob, '2026-11');
  expect(await resolveTopup(ctx.app, ctx.alice, made.topupId, 'approved')).toMatchObject({
    memberId: ctx.bob.userId,
    amountUsd: '5.00000000',
    chatId: 'b',
  });
  expect(await resolveTopup(ctx.app, ctx.alice, made.topupId, 'refused')).toBeUndefined();
  expect(await openTopupFor(ctx.app, ctx.alice, made.approvalId)).toBeUndefined();
  expect(Number(await topupTotal(ctx.app, ctx.bob, '2026-11')) - Number(before)).toBe(5);
  expect(await topupTotal(ctx.app, ctx.bob, '2026-12')).toBe('0');
  const audit = await ctx.owner
    .selectFrom('audit_log')
    .select('args_sha256')
    .where('tool', '=', 'admin.budget.topup')
    .executeTakeFirst();
  expect(audit?.args_sha256).toBe('hash');
});

it('does not show or answer a request whose time has run out', async () => {
  const made = await requestTopup(ctx.app, ctx.bob, ask());
  if (made.outcome !== 'created') throw new Error('expected a request');
  await ctx.owner.updateTable('approvals').set({ status: 'used' }).execute();
  await ctx.owner
    .updateTable('budget_topups')
    .set({ expires_at: new Date(0) })
    .execute();
  expect(await openTopupFor(ctx.app, ctx.alice, made.approvalId)).toBeUndefined();
  expect(await resolveTopup(ctx.app, ctx.alice, made.topupId, 'approved')).toBeUndefined();
});
