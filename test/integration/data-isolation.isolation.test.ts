import { sql, type RawBuilder } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  appendAudit,
  claimTurn,
  clearHistory,
  closeApproval,
  consumeApproval,
  decideApproval,
  endConversation,
  getTurn,
  loadHistory,
  recordWebEvent,
  usageSince,
  webEventsAfter,
} from '../../src/data/index.js';
import { ADMIN_READABLE_TABLES } from '../../src/data/rls.js';
import {
  COVERED,
  expectAuditedAdminRead,
  expectIsolated,
  auditedSoFar,
  isolatedSoFar,
  startIsolation,
  type Isolation,
} from '../helpers/isolation.js';

// One test per user-data table. Each proves, as the app role under forced row-level security, that
// Alice cannot read or write Bob's rows, and where a data function exists, that it agrees.
let ctx: Isolation;
const bobChat = { channel: 'fake', chatId: 'b' };

beforeAll(async () => {
  ctx = await startIsolation();
}, 180_000);
afterAll(async () => {
  await ctx.stop();
});

/** Rows in `table` as the owner role, which sees everything. */
async function count(table: string, where: RawBuilder<unknown> = sql``): Promise<number> {
  const { rows } = await sql<{
    n: string;
  }>`select count(*) as n from ${sql.table(table)} ${where}`.execute(ctx.owner);
  return Number(rows[0]?.n);
}

describe('user-data tables', () => {
  it('turns', async () => {
    await expectIsolated('turns', ctx);
    expect(await getTurn(ctx.app, ctx.alice, ctx.bobTurnId)).toBeUndefined();
    expect(await claimTurn(ctx.app, ctx.alice, ctx.bobTurnId)).toBeUndefined();
    expect((await getTurn(ctx.owner, ctx.bob, ctx.bobTurnId))?.status).toBe('queued');
  });

  it('chat_messages', async () => {
    await expectIsolated('chat_messages', ctx);
    const rules = { turns: 10, maxChars: 10_000 };
    expect(await loadHistory(ctx.app, ctx.alice, bobChat, rules)).toEqual([]);
    await clearHistory(ctx.app, ctx.alice, bobChat);
    expect(await count('chat_messages', sql`where chat_id = 'b'`)).toBe(1);
  });

  it('chat_conversations', async () => {
    await expectIsolated('chat_conversations', ctx);
    expect(await endConversation(ctx.app, ctx.alice, bobChat)).toBeUndefined();
    expect(await count('chat_conversations', sql`where chat_id = 'b'`)).toBe(1);
  });

  it('usage_ledger', async () => {
    await expectIsolated('usage_ledger', ctx);
    const report = await usageSince(ctx.app, ctx.alice, new Date(), 'UTC');
    expect(report.month).toMatchObject({ calls: 1, inputTokens: 1, outputTokens: 2 });
    expect(Number(report.month.costUsd)).toBeCloseTo(0.25);
  });

  it('approvals', async () => {
    await expectIsolated('approvals', ctx);
    const id = ctx.bobApprovalId;
    const now = new Date();
    expect(await consumeApproval(ctx.app, ctx.alice, { id, argsSha256: 'h', now })).toBe(false);
    expect(await closeApproval(ctx.app, ctx.alice, id, 'cancelled')).toBe(false);
    const answer = { id, decision: 'denied' as const, channel: 'fake', chatId: 'a', now };
    expect(await decideApproval(ctx.app, answer)).toBe(false);
    expect(await count('approvals', sql`where status = 'approved'`)).toBe(2);
  });

  it('audit_log', async () => {
    await expectIsolated('audit_log', ctx);
    // A stranger's row has no person: only the owner role can read it.
    await appendAudit(ctx.app, {
      channel: 'fake',
      chatId: 'stranger',
      tool: 't',
      actionType: 'read',
      changesState: false,
      argNames: [],
      extraArgs: 0,
      argsSha256: 'h',
      decision: 'auto',
      outcome: 'refused',
    });
    const seen = await ctx.app
      .transaction()
      .execute((trx) => sql`select 1 from audit_log`.execute(trx));
    expect(seen.rows).toEqual([]);
    expect(await count('audit_log', sql`where user_id is null`)).toBe(1);
  });

  it('users', async () => {
    await expectIsolated('users', ctx);
  });

  it('devices', async () => {
    await expectIsolated('devices', ctx);
  });

  it('the admin reads chats and usage only through the audited path', async () => {
    await expectAuditedAdminRead('chat_messages', ctx);
    await expectAuditedAdminRead('usage_ledger', ctx);
    expect(auditedSoFar()).toEqual([...ADMIN_READABLE_TABLES].sort());
  });

  it('credentials', async () => {
    await expectIsolated('credentials', ctx);
  });

  it('sessions', async () => {
    await expectIsolated('sessions', ctx);
  });

  it('invites', async () => {
    await expectIsolated('invites', ctx);
  });

  it('link_codes', async () => {
    await expectIsolated('link_codes', ctx);
  });

  it('password_links', async () => {
    await expectIsolated('password_links', ctx);
  });

  it('web_events', async () => {
    await expectIsolated('web_events', ctx);
    expect(await webEventsAfter(ctx.app, ctx.alice, 'b', '0')).toEqual([]);
    expect(await recordWebEvent(ctx.app, ctx.alice, 'b', { kind: 'ack', ref: 'r' })).toBeDefined();
    // Bob's own read still shows only his: the row Alice stored under his chat id is hers alone.
    expect(await webEventsAfter(ctx.app, ctx.bob, 'b', '0')).toMatchObject([{ text: 'hello b' }]);
  });

  it('has run for every table in COVERED', () => {
    expect(isolatedSoFar()).toEqual([...COVERED].sort());
  });
});
