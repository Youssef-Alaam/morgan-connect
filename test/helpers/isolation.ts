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
import { adminRead, AdminReadRefused } from '../../src/data/admin-read.js';
import { linkChats } from './link-chats.js';
import { seedAccounts } from './seed-accounts.js';
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
  /** A second workspace, for forged writes that try to cross into it. */
  otherWorkspaceId: string;
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
    inputTokens: chatId === 'b' ? 100 : 1,
    outputTokens: chatId === 'b' ? 200 : 2,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: chatId === 'b' ? 5 : 0.25,
  });
  const approvalId = await createApproval(owner, {
    owner: who,
    ...chat,
    tool: 't',
    argsSha256: 'h',
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  await seedAccounts(owner, who, chatId);
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
    .values({ role: 'member', told_admin_can_read_at: new Date() })
    .returning(['id', 'workspace_id'])
    .executeTakeFirstOrThrow();
  const bob = { userId: member.id, workspaceId: member.workspace_id };
  await owner
    .insertInto('devices')
    .values({ user_id: bob.userId, channel: 'fake', chat_id: 'b' })
    .execute();
  const other = await owner
    .insertInto('workspaces')
    .values({ name: 'Other' })
    .returning('id')
    .executeTakeFirstOrThrow();
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
    otherWorkspaceId: other.id,
    bobTurnId: bobsRows.turnId,
    bobApprovalId: bobsRows.approvalId,
    stop: async () => {
      await app.destroy();
      await owner.destroy();
      await postgres.stop();
    },
  };
}

/**
 * Every user-data table that `expectIsolated` is called with. The catalog test fails when this set
 * differs from the tables the database actually holds a person's rows in.
 */
export const COVERED: readonly string[] = [
  'turns',
  'chat_messages',
  'chat_conversations',
  'usage_ledger',
  'approvals',
  'audit_log',
  'users',
  'devices',
  'credentials',
  'sessions',
  'password_links',
  'invites',
  'web_events',
  'link_codes',
  'totp_factors',
  'backup_codes',
  'passkeys',
  'profile_assignments',
  'budgets',
  'budget_topups',
];

/** Grants the app role is deliberately without (src/data/roles.ts); everything else is granted. */
const READ_ONLY: readonly string[] = [
  'audit_log',
  'profile_assignments',
  'budgets',
  'budget_topups',
];
const NO_UPDATE: readonly string[] = [...READ_ONLY, 'users', 'invites', 'link_codes'];
const NO_DELETE: readonly string[] = READ_ONLY;

/** Tables `expectIsolated` has run for in this file. */
const ran = new Set<string>();
export const isolatedSoFar = (): string[] => [...ran].sort();

const RLS = /row-level security/;
const DENIED = /permission denied/;

async function granted(ctx: Isolation, table: string, verb: 'UPDATE' | 'DELETE'): Promise<boolean> {
  const { rows } = await sql<{ ok: boolean }>`
    select has_table_privilege(current_user, ${`public.${table}`}, ${verb}) as ok`.execute(ctx.app);
  return rows[0]?.ok === true;
}

interface Column {
  name: string;
  /** A primary key with a default: a forged insert leaves it out, so it gets a fresh one. */
  fresh: boolean;
}

async function columnsOf(owner: Db, table: string): Promise<Column[]> {
  const { rows } = await sql<Column>`
    select a.attname as name, (coalesce(i.indisprimary, false) and a.atthasdef) as fresh
    from pg_attribute a
    left join pg_index i on i.indrelid = a.attrelid and i.indisprimary and a.attnum = any(i.indkey)
    where a.attrelid = ${`public.${table}`}::regclass and a.attnum > 0 and not a.attisdropped`.execute(
    owner,
  );
  return rows;
}

/** Alice tries to write this row of someone else's (or hers, moved): the policy must refuse it. */
async function forgedInsert(
  ctx: Isolation,
  table: string,
  from: string,
  change: Record<string, string>,
): Promise<void> {
  const columns = await columnsOf(ctx.owner, table);
  const who = table === 'users' ? 'id' : 'user_id';
  const found = await sql<{ row: object }>`
    select row_to_json(t) as row from ${sql.table(table)} t where ${sql.id(who)} = ${from} limit 1`.execute(
    ctx.owner,
  );
  const row = { ...found.rows[0]?.row, ...change };
  const names = sql.join(columns.filter((c) => !c.fresh).map((c) => sql.id(c.name)));
  const forged = withOwner(ctx.app, ctx.alice, (trx) =>
    sql`insert into ${sql.table(table)} (${names}) select ${names}
      from json_populate_record(null::${sql.table(table)}, ${JSON.stringify(row)}::json)`.execute(
      trx,
    ),
  );
  await expect(forged).rejects.toThrow(RLS);
}

/** Alice's own update that would hand her row to Bob or to another workspace must be refused. */
async function forgedUpdate(ctx: Isolation, table: string, set: string, to: string): Promise<void> {
  const who = sql.id(table === 'users' ? 'id' : 'user_id');
  const moved = withOwner(ctx.app, ctx.alice, (trx) =>
    sql`update ${sql.table(table)} set ${sql.id(set)} = ${to} where ${who} = ${ctx.alice.userId}`.execute(
      trx,
    ),
  );
  await expect(moved).rejects.toThrow(RLS);
}

/**
 * User A cannot read or write user B's rows in `table`, directly under row-level security as the
 * app role: A sees only A's rows; A's update or delete of B's row changes nothing; an insert that
 * carries B's user, or another workspace, is refused by the policy; A cannot hand her own row to
 * B (update of user_id) or move it to another workspace. Where the app role has no update or
 * delete grant at all, that is asserted instead, so a missing policy cannot hide behind it. B's
 * rows are the same afterwards, checked as the owner role.
 */
export async function expectIsolated(table: string, ctx: Isolation): Promise<void> {
  expect(COVERED).toContain(table);
  ran.add(table);
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
  await expectWrites(ctx, table);
  await forgedInsert(ctx, table, bob.userId, {});
  const hasWorkspace = (await columnsOf(owner, table)).some((c) => c.name === 'workspace_id');
  if (hasWorkspace) {
    await forgedInsert(ctx, table, alice.userId, { workspace_id: ctx.otherWorkspaceId });
  }
  expect(await bobsRows()).toBe(before);
}

/** Update and delete: refused by grant where the app role has none, by the policy where it has. */
async function expectWrites(ctx: Isolation, table: string): Promise<void> {
  const { app, alice, bob } = ctx;
  const who = sql.id(table === 'users' ? 'id' : 'user_id');
  const from = sql.table(table);
  const run = (statement: ReturnType<typeof sql>) =>
    withOwner(app, alice, (trx) => statement.execute(trx));
  const grants = {
    update: await granted(ctx, table, 'UPDATE'),
    delete: await granted(ctx, table, 'DELETE'),
  };
  expect(grants).toEqual({
    update: !NO_UPDATE.includes(table),
    delete: !NO_DELETE.includes(table),
  });
  const update = run(sql`update ${from} set ${who} = ${who} where ${who} = ${bob.userId}`);
  if (grants.update) {
    expect((await update).numAffectedRows).toBe(0n);
    await forgedUpdate(ctx, table, table === 'users' ? 'id' : 'user_id', bob.userId);
    if ((await columnsOf(ctx.owner, table)).some((c) => c.name === 'workspace_id')) {
      await forgedUpdate(ctx, table, 'workspace_id', ctx.otherWorkspaceId);
    }
  } else {
    await expect(update).rejects.toThrow(DENIED);
  }
  const remove = run(sql`delete from ${from} where ${who} = ${bob.userId}`);
  if (grants.delete) expect((await remove).numAffectedRows).toBe(0n);
  else await expect(remove).rejects.toThrow(DENIED);
}

/** Admin-readable tables `expectAuditedAdminRead` has run for in this file. */
const audited = new Set<string>();
export const auditedSoFar = (): string[] => [...audited].sort();

/** What the admin reads of Bob's rows in this table comes back as, by the table's own kind. */
const READERS = {
  chat_messages: (ctx: Isolation, reason: string) =>
    adminRead.chat(ctx.app, ctx.alice, ctx.bob.userId, reason),
  usage_ledger: (ctx: Isolation, reason: string) =>
    adminRead.usage(ctx.app, ctx.alice, ctx.bob.userId, reason),
} as const;

/**
 * The admin rule for an admin-readable table: Alice (admin) reads exactly Bob's rows, and an
 * `admin.read` audit row naming who, whose and why exists in the same step; Bob (a member) calling
 * the same path is refused with a typed error and an audited refusal, and sees none of Alice's rows.
 */
export async function expectAuditedAdminRead(
  table: keyof typeof READERS,
  ctx: Isolation,
): Promise<void> {
  audited.add(table);
  const trail = (outcome: string) =>
    sql<{ user_id: string; subject_user_id: string; reason: string }>`
      select user_id, subject_user_id, reason from audit_log
      where action_type = 'admin.read' and tool = ${`admin.read.${table === 'usage_ledger' ? 'usage' : 'chat'}`}
        and outcome = ${outcome} and reason = ${`why ${table}`}`.execute(ctx.owner);
  const rows = await READERS[table](ctx, `why ${table}`);
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((row) => row.chatId === 'b')).toBe(true);
  expect((await trail('ok')).rows).toEqual([
    { user_id: ctx.alice.userId, subject_user_id: ctx.bob.userId, reason: `why ${table}` },
  ]);
  const asMember = adminRead[table === 'usage_ledger' ? 'usage' : 'chat'](
    ctx.app,
    ctx.bob,
    ctx.alice.userId,
    `why ${table}`,
  );
  await expect(asMember).rejects.toBeInstanceOf(AdminReadRefused);
  expect((await trail('refused')).rows).toEqual([
    { user_id: ctx.bob.userId, subject_user_id: ctx.alice.userId, reason: `why ${table}` },
  ]);
}
