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
