import { sql } from 'kysely';
import type { Db, Owner } from './db.js';
import { withOwner } from './tenancy.js';

/** The app role may execute exactly this (ensureAppRole). */
export const AUDIT_VIEW_FUNCTIONS: readonly string[] = [
  'admin_list_audit(uuid, text, text, text, timestamptz, timestamptz, bigint, integer)',
];

export interface AuditFilter {
  /** Rows made by this person or about them. */
  personId?: string;
  actionType?: string;
  decision?: 'auto' | 'ask' | 'off';
  outcome?: string;
  /** From (included) and to (excluded). */
  from?: Date;
  to?: Date;
  /** The `id` of the oldest row already shown; the page holds the rows before it. */
  before?: string;
  limit?: number;
}

export interface AuditRow {
  id: string;
  at: string;
  personId: string | null;
  person: string | null;
  subjectId: string | null;
  subject: string | null;
  channel: string;
  tool: string;
  actionType: string;
  decision: string;
  outcome: string;
  reason: string | null;
}

export interface AuditPage {
  rows: AuditRow[];
  /** True when older rows match; ask again with `before` set to the last row's id. */
  more: boolean;
  /** Every action type in the log, for the filter. */
  actions: string[];
}

/**
 * One page of the workspace's audit log, newest first. Undefined when the caller is not the admin
 * (the refusal is audited by the database function). Read-only: nothing here changes a row.
 */
export async function listAudit(
  db: Db,
  admin: Owner,
  filter: AuditFilter,
): Promise<AuditPage | undefined> {
  const f = filter;
  const { rows } = await withOwner(db, admin, (trx) =>
    sql<{ page: AuditPage | null }>`select admin_list_audit(${f.personId ?? null}::uuid,
      ${f.actionType ?? null}, ${f.decision ?? null}, ${f.outcome ?? null},
      ${f.from ?? null}::timestamptz, ${f.to ?? null}::timestamptz, ${f.before ?? null}::bigint,
      ${f.limit ?? null}::integer) as page`.execute(trx),
  );
  return rows[0]?.page ?? undefined;
}
