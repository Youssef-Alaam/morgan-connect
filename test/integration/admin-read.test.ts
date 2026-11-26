import { sql } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { adminRead, AdminReadRefused } from '../../src/data/admin-read.js';
import { loadHistory, withOwner } from '../../src/data/index.js';
import { startIsolation, type Isolation } from '../helpers/isolation.js';

// The admin path's own rules; the per-table audited read is in data-isolation.isolation.test.ts.
let ctx: Isolation;
beforeAll(async () => {
  ctx = await startIsolation();
}, 180_000);
afterAll(async () => {
  await ctx.stop();
});

const auditRows = async (outcome: string): Promise<number> => {
  const { rows } = await sql<{ n: string }>`
    select count(*) as n from audit_log where action_type = 'admin.read' and outcome = ${outcome}`.execute(
    ctx.owner,
  );
  return Number(rows[0]?.n);
};

it('keeps the admin to their own rows on the normal path', async () => {
  const mine = await withOwner(ctx.app, ctx.alice, (trx) =>
    trx.selectFrom('chat_messages').select('user_id').execute(),
  );
  expect(new Set(mine.map((r) => r.user_id))).toEqual(new Set([ctx.alice.userId]));
  const history = await loadHistory(
    ctx.app,
    ctx.alice,
    { channel: 'fake', chatId: 'b' },
    {
      turns: 10,
      maxChars: 10_000,
    },
  );
  expect(history).toEqual([]);
});

it('returns the member chat and usage, with the admin note on the row', async () => {
  const chat = await adminRead.chat(ctx.app, ctx.alice, ctx.bob.userId, 'support ticket 12');
  expect(chat).toMatchObject([{ role: 'user', text: 'hi', chatId: 'b' }]);
  const usage = await adminRead.usage(ctx.app, ctx.alice, ctx.bob.userId, 'cost check');
  expect(usage).toMatchObject([{ model: 'm', inputTokens: '100', costUsd: '5.00000000' }]);
});

it('returns nothing when the audit insert fails', async () => {
  await sql`create function fail_admin_audit() returns trigger language plpgsql as $$
    begin raise exception 'audit down'; end $$`.execute(ctx.owner);
  await sql`create trigger fail_admin_audit before insert on audit_log
    for each row when (new.action_type = 'admin.read') execute function fail_admin_audit()`.execute(
    ctx.owner,
  );
  try {
    await expect(adminRead.chat(ctx.app, ctx.alice, ctx.bob.userId, 'x')).rejects.toThrow(
      'audit down',
    );
  } finally {
    await sql`drop trigger fail_admin_audit on audit_log`.execute(ctx.owner);
  }
});

it('refuses, and audits, a missing reason and a person in another workspace', async () => {
  const before = await auditRows('refused');
  await expect(adminRead.chat(ctx.app, ctx.alice, ctx.bob.userId, '  ')).rejects.toBeInstanceOf(
    AdminReadRefused,
  );
  const stranger = await ctx.owner
    .insertInto('users')
    .values({ role: 'member', workspace_id: ctx.otherWorkspaceId })
    .returning('id')
    .executeTakeFirstOrThrow();
  await expect(adminRead.usage(ctx.app, ctx.alice, stranger.id, 'peek')).rejects.toBeInstanceOf(
    AdminReadRefused,
  );
  expect(await auditRows('refused')).toBe(before + 2);
});

it('cannot be called by name as someone else, or past its audit gate', async () => {
  const before = await auditRows('refused');
  // Bob names Alice as the admin: the person set on the transaction is Bob, so it is refused.
  const forged = withOwner(ctx.app, ctx.bob, (trx) =>
    sql`select admin_read_chat(${ctx.alice.userId}::uuid, ${ctx.bob.userId}::uuid, 'me', 5)`.execute(
      trx,
    ),
  );
  expect((await forged).rows).toEqual([{ admin_read_chat: null }]);
  expect(await auditRows('refused')).toBe(before + 1);
  // The gate that writes the audit row is not for the app role: rows cannot be had without it.
  const gate = withOwner(ctx.app, ctx.alice, (trx) =>
    sql`select admin_read_gate('chat', ${ctx.alice.userId}::uuid, ${ctx.bob.userId}::uuid, 'r')`.execute(
      trx,
    ),
  );
  await expect(gate).rejects.toThrow(/permission denied/);
});
