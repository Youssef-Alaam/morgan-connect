import { sql } from 'kysely';
import { expect } from 'vitest';
import {
  appendHistory,
  createApproval,
  createDb,
  ensureAppRole,
  insertTurn,
  migrateToLatest,
  recordUsage,
  withOwner,
  type Db,
  type Owner,
} from '../../src/data/index.js';
import { linkChats } from './link-chats.js';
import { startPostgres } from './postgres.js';

/** Two people in two chats, one row of theirs in every user-data table, and the two database roles. */
export interface Isolation {
  /** The owner role: sees everything, used to seed and to check nothing changed. */
  owner: Db;
  /** The app role, with row-level security forced. Every assertion about isolation runs as this. */
  app: Db;
  /** Alice (admin) has chat `a`; Bob (member) has chat `b`. */
  alice: Owner;
  bob: Owner;
  bobTurnId: string;
  bobApprovalId: string;
  stop: () => Promise<void>;
}

const ids = (who: Owner, chatId: string) => ({
  user_id: who.userId,
  workspace_id: who.workspaceId,
  channel: 'fake',
  chat_id: chatId,
});

/** One row of this person's in each table that has no seed of its own, as the owner role. */
async function seedRows(
  owner: Db,
  who: Owner,
  chatId: string,
): Promise<{ turnId: string; approvalId: string }> {
  const chat = { channel: 'fake', chatId };
  const turn = await insertTurn(owner, { ...chat, idempotencyKey: chatId, text: 'x' });
  await appendHistory(owner, chat, [{ role: 'user', text: 'hi' }], who);
  await owner.insertInto('chat_conversations').values(ids(who, chatId)).execute();
  await recordUsage(owner, {
    ...who,
    ...chat,
    model: 'm',
    status: 'ok',
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
  });
  const approvalId = await createApproval(owner, {
    owner: who,
    ...chat,
    tool: 't',
    argsSha256: 'h',
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  await owner
    .insertInto('audit_log')
    .values({
      ...ids(who, chatId),
      tool: 't',
      action_type: 'read',
      changes_state: false,
      arg_names: [],
      extra_args: 0,
      args_sha256: 'h',
      decision: 'auto',
      outcome: 'ok',
    })
    .execute();
  return { turnId: turn.id, approvalId };
}

/** Boot Postgres, migrate as the owner, and seed Alice and Bob with one row each per table. */
export async function startIsolation(): Promise<Isolation> {
  const postgres = await startPostgres();
  const owner = createDb(postgres.url);
  await migrateToLatest(owner);
  const alice = await linkChats(owner, ['a']);
  const member = await owner
    .insertInto('users')
    .values({ role: 'member' })
    .returning(['id', 'workspace_id'])
    .executeTakeFirstOrThrow();
  const bob = { userId: member.id, workspaceId: member.workspace_id };
  await owner
    .insertInto('devices')
    .values({ user_id: bob.userId, channel: 'fake', chat_id: 'b' })
    .execute();
  await seedRows(owner, alice, 'a');
  const bobsRows = await seedRows(owner, bob, 'b');
  // Bob's approval is approved, so only the owner check (not its status) keeps Alice out.
  await owner.updateTable('approvals').set({ status: 'approved' }).execute();
  const url = new URL(postgres.url);
  url.username = 'morgan_app';
  url.password = 'app-pass-isolation';
  await ensureAppRole(owner, url.toString());
  const app = createDb(url.toString());
  return {
    owner,
    app,
    alice,
    bob,
    bobTurnId: bobsRows.turnId,
    bobApprovalId: bobsRows.approvalId,
    stop: async () => {
      await app.destroy();
      await owner.destroy();
      await postgres.stop();
    },
  };
}

/** Run a statement that may be refused outright (no privilege) and count the rows it changed. */
async function changed(run: Promise<{ numAffectedRows?: bigint | undefined }>): Promise<number> {
  try {
    return Number((await run).numAffectedRows ?? 0n);
  } catch (error) {
    if (error instanceof Error && /permission denied|row-level security/.test(error.message)) {
      return 0;
    }
    throw error;
  }
}

/**
 * User A cannot read or write user B's rows in `table`, directly under row-level security as the
 * app role: reads show only A's rows, A cannot see, update or delete B's row, and an insert that
 * carries B's user is refused. B's rows are the same afterwards (checked as the owner role).
 */
export async function expectIsolated(table: string, ctx: Isolation): Promise<void> {
  const { owner, app, alice, bob } = ctx;
  const who = sql.id(table === 'users' ? 'id' : 'user_id');
  const from = sql.table(table);
  const bobsRows = () =>
    sql<{ n: string }>`select count(*) as n from ${from} where ${who} = ${bob.userId}`
      .execute(owner)
      .then((r) => r.rows[0]?.n);
  const before = await bobsRows();
  expect(Number(before)).toBeGreaterThan(0);
  await withOwner(app, alice, async (trx) => {
    const seen = await sql<{ id: string }>`select ${who} as id from ${from}`.execute(trx);
    expect(seen.rows.length).toBeGreaterThan(0);
    expect(new Set(seen.rows.map((r) => r.id))).toEqual(new Set([alice.userId]));
    const theirs = await sql`select 1 from ${from} where ${who} = ${bob.userId}`.execute(trx);
    expect(theirs.rows).toEqual([]);
  });
  const touch = (statement: ReturnType<typeof sql>) =>
    changed(withOwner(app, alice, (trx) => statement.execute(trx)));
  expect(await touch(sql`update ${from} set ${who} = ${who} where ${who} = ${bob.userId}`)).toBe(0);
  expect(await touch(sql`delete from ${from} where ${who} = ${bob.userId}`)).toBe(0);
  const row = await sql`select * from ${from} where ${who} = ${bob.userId} limit 1`.execute(owner);
  const forged = withOwner(app, alice, (trx) =>
    sql`insert into ${from} select * from json_populate_record(null::${from}, ${JSON.stringify(row.rows[0])}::json)`.execute(
      trx,
    ),
  );
  await expect(forged).rejects.toThrow(/row-level security|permission denied/);
  expect(await bobsRows()).toBe(before);
}
