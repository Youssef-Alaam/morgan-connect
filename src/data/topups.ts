import { sql } from 'kysely';
import type { Db, Owner } from './db.js';
import { withOwner } from './tenancy.js';

/** The app role may execute exactly these (ensureAppRole). */
export const TOPUP_FUNCTIONS: readonly string[] = [
  'request_topup(numeric, text, text, text, text, timestamptz, timestamptz, text)',
  'cancel_topup(uuid)',
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
