import { sql } from 'kysely';
import type { Db, Owner } from './db.js';
import { withOwner } from './tenancy.js';

/** The app role may execute exactly these (ensureAppRole). */
export const TOPUP_FUNCTIONS: readonly string[] = [
  'request_topup(numeric, text, text, text, text, timestamptz, timestamptz, text)',
  'admin_open_topup(uuid)',
  'admin_resolve_topup(uuid, text)',
  'cancel_topup(uuid)',
  'admin_set_topup_amount(uuid, numeric)',
  'admin_list_topups()',
];

export type TopupRequest =
  | { outcome: 'created'; topupId: string; approvalId: string; adminChatId: string; who: string }
  /** A request from this person is already waiting. */
  | { outcome: 'open' }
  /** Nobody to ask: no admin chat on the channel. */
  | { outcome: 'no_admin' }
  | { outcome: 'unavailable' };

export interface NewTopup {
  /** A decimal string with 8 places. */
  amountUsd: string;
  /** The local month it raises, `2026-11`. */
  month: string;
  /** Where the member asked, so the answer goes back there. */
  channel: string;
  chatId: string;
  /** The channel the admin is asked on. */
  adminChannel: string;
  now: Date;
  expiresAt: Date;
  /** Fingerprint of the exact request (the admin's approval is bound to it). */
  argsSha256: string;
}

/**
 * A member asks for more. Opens the request and the admin's question in one step, and says where
 * to send it. At most one request per person stays open; an unanswered one past its time is closed
 * first. Writes an audit row.
 */
export async function requestTopup(db: Db, member: Owner, ask: NewTopup): Promise<TopupRequest> {
  const { rows } = await withOwner(db, member, (trx) =>
    sql<RequestRow>`select * from request_topup(${ask.amountUsd}::numeric, ${ask.month}, ${ask.channel},
      ${ask.chatId}, ${ask.adminChannel}, ${ask.now}::timestamptz, ${ask.expiresAt}::timestamptz,
      ${ask.argsSha256})`.execute(trx),
  );
  return asRequest(rows[0]);
}

interface RequestRow {
  outcome: string;
  topup_id: string | null;
  approval_id: string | null;
  admin_chat: string | null;
  who: string | null;
}

const present = (value: string | null): string => {
  if (value === null) throw new Error('request_topup returned an incomplete row');
  return value;
};

function asRequest(row: RequestRow | undefined): TopupRequest {
  if (row?.outcome === 'created') {
    return {
      outcome: 'created',
      topupId: present(row.topup_id),
      approvalId: present(row.approval_id),
      adminChatId: present(row.admin_chat),
      who: present(row.who),
    };
  }
  return {
    outcome: row?.outcome === 'open' || row?.outcome === 'no_admin' ? row.outcome : 'unavailable',
  };
}

export interface OpenTopup {
  topupId: string;
  memberId: string;
  /** A decimal string, as the database holds it. */
  amountUsd: string;
  month: string;
}

/** The open request behind an admin's question, or undefined when it is not a top-up (or not the admin's). */
export function openTopupFor(
  db: Db,
  admin: Owner,
  approvalId: string,
): Promise<OpenTopup | undefined> {
  return withOwner(db, admin, async (trx) => {
    const { rows } = await sql<{
      topup_id: string;
      member_id: string;
      amount: string;
      month: string;
    }>`select * from admin_open_topup(${approvalId}::uuid)`.execute(trx);
    const row = rows[0];
    return (
      row && {
        topupId: row.topup_id,
        memberId: row.member_id,
        amountUsd: row.amount,
        month: row.month,
      }
    );
  });
}

export interface ResolvedTopup {
  memberId: string;
  amountUsd: string;
  /** Where the member asked. */
  channel: string;
  chatId: string;
}

/** The admin's answer, once: undefined when it is not theirs to give or was already answered. Audited. */
export function resolveTopup(
  db: Db,
  admin: Owner,
  id: string,
  status: 'approved' | 'refused',
): Promise<ResolvedTopup | undefined> {
  return withOwner(db, admin, async (trx) => {
    const { rows } = await sql<{
      member_id: string;
      amount: string;
      channel: string;
      chat_id: string;
    }>`select * from admin_resolve_topup(${id}::uuid, ${status})`.execute(trx);
    const row = rows[0];
    return (
      row && {
        memberId: row.member_id,
        amountUsd: row.amount,
        channel: row.channel,
        chatId: row.chat_id,
      }
    );
  });
}

/** Close a request whose question could not be shown, so the member may ask again. */
export function cancelTopup(db: Db, member: Owner, id: string): Promise<boolean> {
  return withOwner(db, member, async (trx) => {
    const { rows } = await sql<{ ok: boolean }>`select cancel_topup(${id}::uuid) as ok`.execute(
      trx,
    );
    return rows[0]?.ok === true;
  });
}

/** The approved top-ups for this person in one local month (`2026-11`), as a decimal string. */
export function topupTotal(db: Db, owner: Owner, month: string): Promise<string> {
  return withOwner(db, owner, async (trx) => {
    const row = await trx
      .selectFrom('budget_topups')
      .select(sql<string>`coalesce(sum(amount_usd), 0)::text`.as('total'))
      .where('user_id', '=', owner.userId)
      .where('status', '=', 'approved')
      .where('month', '=', month)
      .executeTakeFirstOrThrow();
    return row.total;
  });
}

/** Up to 6 whole digits and 8 decimals, as for a budget. */
const MONEY = /^\d{1,6}(\.\d{1,8})?$/;

/**
 * Set the step an approved top-up adds for one person (undefined goes back to the install's).
 * Admin only: false when the caller is not one, or the person is not in their workspace. Audited.
 */
export async function setTopupStep(
  db: Db,
  admin: Owner,
  memberId: string,
  amountUsd: string | undefined,
): Promise<boolean> {
  if (amountUsd !== undefined && (!MONEY.test(amountUsd) || Number(amountUsd) === 0)) {
    throw new Error('A top-up step is a plain USD amount above 0, with up to 8 decimals');
  }
  return withOwner(db, admin, async (trx) => {
    const { rows } = await sql<{ ok: boolean }>`
      select admin_set_topup_amount(${memberId}::uuid, ${amountUsd ?? null}::numeric) as ok`.execute(
      trx,
    );
    return rows[0]?.ok === true;
  });
}

/** This person's own top-up step, or undefined when the install's applies. */
export function topupStepOf(db: Db, owner: Owner): Promise<string | undefined> {
  return withOwner(db, owner, async (trx) => {
    const row = await trx
      .selectFrom('users')
      .select('topup_amount_usd')
      .where('id', '=', owner.userId)
      .executeTakeFirst();
    return row?.topup_amount_usd ?? undefined;
  });
}

export interface WaitingTopup {
  id: string;
  memberId: string;
  email: string | undefined;
  amountUsd: string;
  month: string;
  createdAt: Date;
  expiresAt: Date;
}

/** The requests in the admin's workspace still waiting for an answer, oldest first; empty for a non-admin. */
export function listWaitingTopups(db: Db, admin: Owner): Promise<WaitingTopup[]> {
  return withOwner(db, admin, async (trx) => {
    const { rows } = await sql<{
      id: string;
      member_id: string;
      email: string | null;
      amount: string;
      month: string;
      created_at: Date;
      expires_at: Date;
    }>`select * from admin_list_topups()`.execute(trx);
    return rows.map((row) => ({
      id: row.id,
      memberId: row.member_id,
      email: row.email ?? undefined,
      amountUsd: row.amount,
      month: row.month,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    }));
  });
}
