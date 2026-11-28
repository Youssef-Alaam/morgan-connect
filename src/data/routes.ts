import { sql } from 'kysely';
import type { Db, Owner } from './db.js';
import { withOwner } from './tenancy.js';

/** The app role may execute exactly these (ensureAppRole). */
export const ROUTE_FUNCTIONS: readonly string[] = ['admin_set_route(text, boolean)'];

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
