import { type Kysely, sql } from 'kysely';

/**
 * When a worker claimed the turn (M2-11b). A second job for a turn that is still running must
 * leave it alone; only a job redelivered after the first one's expiry may call it interrupted.
 */

/** A turn already running when this lands has no claim time: take its creation as the claim. */
export async function backfillClaimedAt(db: Kysely<unknown>): Promise<void> {
  await sql`update turns set claimed_at = created_at
    where status = 'sending' and claimed_at is null`.execute(db);
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table turns add column claimed_at timestamptz`.execute(db);
  await backfillClaimedAt(db);
}
