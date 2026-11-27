import { type Kysely, sql } from 'kysely';

/**
 * A question to the owner is an event on the web stream (M2-12b): `ref` is the approval id and
 * `text` the exact arguments, the same text Telegram shows. Only the check on `kind` changes.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table web_events drop constraint web_events_kind_check,
    add constraint web_events_kind_check check (kind in ('ack', 'message', 'approval'))`.execute(
    db,
  );
}
