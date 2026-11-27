import { type Kysely, sql } from 'kysely';

/**
 * A system path (like 0012) for the sweep of dead turns (M2-11c): turns still `sending` whose
 * claim is older than the job expiry belong to a worker that died, and each holds one of its
 * person's parallel-task slots. It fixes one outcome (failed, interrupted) and takes only an age.
 */
const SAFE = sql.raw('security definer set search_path = pg_catalog, public, pg_temp');

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create function public.system_expire_stale_turns(p_older_than_seconds integer)
    returns integer language sql ${SAFE} as $$
      with gone as (update public.turns set status = 'failed', error = 'interrupted'
        where status = 'sending' and claimed_at <= now() - make_interval(secs => p_older_than_seconds)
        returning 1)
      select count(*)::integer from gone $$`.execute(db);
}
