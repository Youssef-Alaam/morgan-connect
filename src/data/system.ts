import { sql } from 'kysely';
import type { Db, Owner } from './db.js';

/**
 * The named system paths: the only reads and writes that run before a person is known. Each calls
 * one fixed database function (migration 0012), so none of them can be widened into a bypass.
 */

/** Every system path by signature; the app role may execute these and no other function. */
export const SYSTEM_FUNCTIONS: readonly string[] = [
  'system_chat_owner(text, text)',
  'system_turn_owner(uuid)',
  'system_queued_turn_ids()',
  'system_expire_open_approvals()',
  'system_install_claimed()',
  'system_claim_install(text, text, text)',
  'system_credentials_by_email(text)',
  'system_session_owner(text)',
  'system_issue_admin_link(text, integer)',
  'system_redeem_link(text, text, text)',
  'system_sweep_sessions()',
  'system_link_live(text)',
  'system_invite_live(text)',
  'system_redeem_invite(text, text, text)',
];

interface OwnerRow {
  user_id: string;
  workspace_id: string;
}
const toOwner = (row: OwnerRow | undefined): Owner | undefined =>
  row === undefined ? undefined : { userId: row.user_id, workspaceId: row.workspace_id };

/** Unknown-sender gate: the person behind exactly this chat, or undefined if it is not linked. */
export async function chatOwner(
  db: Db,
  chat: { channel: string; chatId: string },
): Promise<Owner | undefined> {
  const { rows } = await sql<OwnerRow>`
    select user_id, workspace_id from system_chat_owner(${chat.channel}, ${chat.chatId})`.execute(
    db,
  );
  return toOwner(rows[0]);
}

/** Worker: whose turn a queued job is, from the turn id alone. */
export async function turnOwner(db: Db, turnId: string): Promise<Owner | undefined> {
  const { rows } = await sql<OwnerRow>`
    select user_id, workspace_id from system_turn_owner(${turnId}::uuid)`.execute(db);
  return toOwner(rows[0]);
}

/** Startup sweep: every turn still queued, whoever it belongs to. */
export async function queuedTurnIds(db: Db): Promise<string[]> {
  const { rows } = await sql<{ id: string }>`select id from system_queued_turn_ids() as id`.execute(
    db,
  );
  return rows.map((row) => row.id);
}

/** Startup sweep: close every open question. Returns how many. */
export async function expireOpenApprovals(db: Db): Promise<number> {
  const { rows } = await sql<{ n: number }>`select system_expire_open_approvals() as n`.execute(db);
  return rows[0]?.n ?? 0;
}

/** Setup: true once anyone has claimed the install. */
export async function installClaimed(db: Db): Promise<boolean> {
  const { rows } = await sql<{ claimed: boolean }>`
    select system_install_claimed() as claimed`.execute(db);
  return rows[0]?.claimed === true;
}

/** Setup: mark the code claimed, create the admin and link the chat, in one step. */
export async function claimInstall(
  db: Db,
  claim: { codeHash: string; channel: string; chatId: string },
): Promise<boolean> {
  const { rows } = await sql<{ ok: boolean }>`
    select system_claim_install(${claim.codeHash}, ${claim.channel}, ${claim.chatId}) as ok`.execute(
    db,
  );
  return rows[0]?.ok === true;
}

/** Sign-in: the person and password hash behind an email, or undefined. */
export async function credentialsByEmail(
  db: Db,
  email: string,
): Promise<(Owner & { passwordHash: string }) | undefined> {
  const { rows } = await sql<OwnerRow & { password_hash: string }>`
    select user_id, workspace_id, password_hash from system_credentials_by_email(${email})`.execute(
    db,
  );
  const row = rows[0];
  const owner = toOwner(row);
  return row === undefined || owner === undefined
    ? undefined
    : { ...owner, passwordHash: row.password_hash };
}

/** Session cookie: the person behind a live session token hash, with the session id. */
export async function sessionOwner(
  db: Db,
  tokenHash: string,
): Promise<(Owner & { sessionId: string; mustChange: boolean }) | undefined> {
  const { rows } = await sql<OwnerRow & { session_id: string; must_change: boolean }>`
    select user_id, workspace_id, session_id, must_change
    from system_session_owner(${tokenHash})`.execute(db);
  const row = rows[0];
  const owner = toOwner(row);
  return row === undefined || owner === undefined
    ? undefined
    : { ...owner, sessionId: row.session_id, mustChange: row.must_change };
}

/** The admin's first-password link, if the admin has no password yet. False when none is needed. */
export async function issueAdminLink(
  db: Db,
  tokenHash: string,
  ttlSeconds: number,
): Promise<boolean> {
  const { rows } = await sql<{ ok: boolean }>`
    select system_issue_admin_link(${tokenHash}, ${ttlSeconds}::integer) as ok`.execute(db);
  return rows[0]?.ok === true;
}

/** Spend a password link and create the login in one step; undefined if the link is not live. */
export async function redeemLink(
  db: Db,
  link: { tokenHash: string; email: string; passwordHash: string },
): Promise<Owner | undefined> {
  const { rows } = await sql<OwnerRow>`
    select user_id, workspace_id
    from system_redeem_link(${link.tokenHash}, ${link.email}, ${link.passwordHash})`.execute(db);
  return toOwner(rows[0]);
}

/** Drop expired sessions and their web devices, whoever they belong to. Returns how many. */
export async function sweepSessions(db: Db): Promise<number> {
  const { rows } = await sql<{ n: number }>`select system_sweep_sessions() as n`.execute(db);
  return rows[0]?.n ?? 0;
}

/** True while a password link is unspent and unexpired (it is not spent by asking). */
export async function linkLive(db: Db, tokenHash: string): Promise<boolean> {
  const { rows } = await sql<{ ok: boolean }>`select system_link_live(${tokenHash}) as ok`.execute(
    db,
  );
  return rows[0]?.ok === true;
}

/** True while an invite is unspent and unexpired (asking does not spend it). */
export async function inviteLive(db: Db, tokenHash: string): Promise<boolean> {
  const { rows } = await sql<{ ok: boolean }>`
    select system_invite_live(${tokenHash}) as ok`.execute(db);
  return rows[0]?.ok === true;
}

/** Spend an invite and create the person and their login in one step; undefined if it is not live. */
export async function redeemInvite(
  db: Db,
  invite: { tokenHash: string; email: string; passwordHash: string },
): Promise<Owner | undefined> {
  const { rows } = await sql<OwnerRow>`
    select user_id, workspace_id
    from system_redeem_invite(${invite.tokenHash}, ${invite.email}, ${invite.passwordHash})`.execute(
    db,
  );
  return toOwner(rows[0]);
}
