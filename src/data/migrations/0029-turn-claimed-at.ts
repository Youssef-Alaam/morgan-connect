import { type Kysely, sql } from 'kysely';

/**
 * When a worker claimed the turn (M2-11b). A second job for a turn that is still running must
 * leave it alone; only a job redelivered after the first one's expiry may call it interrupted.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table turns add column claimed_at timestamptz`.execute(db);
}
