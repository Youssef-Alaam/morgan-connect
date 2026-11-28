import { sql } from 'kysely';
import type { Db, Owner } from './db.js';
import { withOwner } from './tenancy.js';

/** The app role may execute exactly these (ensureAppRole). */
export const ROUTE_FUNCTIONS: readonly string[] = [
  'admin_set_route(text, boolean)',
  'admin_providers_state()',
];

export interface ProvidersState {
  /** Only the switches that were ever set; a route with no entry is on. */
  routes: { id: string; enabled: boolean }[];
  /** The newest message each channel received, ISO time. */
  channels: { id: string; lastMessageAt: string }[];
}

/** Is this route on? A route nobody ever switched is on. */
export async function routeEnabled(db: Db, id: string): Promise<boolean> {
  const row = await db
    .selectFrom('routes')
    .select('enabled')
    .where('id', '=', id)
    .executeTakeFirst();
  return row?.enabled !== false;
}

/**
 * Switch a route on or off. Only an admin can: false when the caller is not one. Either way an
 * audit row is written in the same step.
 */
export function setRoute(db: Db, admin: Owner, id: string, enabled: boolean): Promise<boolean> {
  return withOwner(db, admin, async (trx) => {
    const { rows } = await sql<{ ok: boolean }>`
      select admin_set_route(${id}, ${enabled}) as ok`.execute(trx);
    return rows[0]?.ok === true;
  });
}

/** The switches and channel activity for the admin's page; undefined for anyone else (audited). */
export async function providersState(db: Db, admin: Owner): Promise<ProvidersState | undefined> {
  const { rows } = await withOwner(db, admin, (trx) =>
    sql<{ state: ProvidersState | null }>`select admin_providers_state() as state`.execute(trx),
  );
  return rows[0]?.state ?? undefined;
}
