import { type Kysely, sql } from 'kysely';

/**
 * How a question ended is an event on the web stream (M2-14b): `ref` is the approval id and `text`
 * the outcome word, so a card still on screen, or replayed after a reload, shows it settled. Only
 * the check on `kind` changes.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table web_events drop constraint web_events_kind_check,
    add constraint web_events_kind_check
    check (kind in ('ack', 'message', 'approval', 'approval_closed'))`.execute(db);
}
