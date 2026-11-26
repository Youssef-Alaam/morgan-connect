import { type Kysely, sql } from 'kysely';

/**
 * What a web chat shows (M2-12a): one row per event on a person's browser session, read back in
 * order by the live stream and replayed after a dropped connection. `chat_id` is the session id
 * (the `web` device). Under the same RLS as every user-data table, so a stream can only ever read
 * its own person's rows. The ids come from a sequence: an event's id is its place in the stream.
 */
const SAFE = sql.raw('security definer set search_path = pg_catalog, public, pg_temp');
const ME = sql`nullif(current_setting('app.user_id', true), '')::uuid`;
const WS = sql`nullif(current_setting('app.workspace_id', true), '')::uuid`;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create table web_events (id bigserial primary key,
    user_id uuid not null, workspace_id uuid not null, chat_id text not null,
    kind text not null check (kind in ('ack', 'message')),
    ref text, text text not null default '', created_at timestamptz not null default now(),
    foreign key (user_id, workspace_id) references users (id, workspace_id))`.execute(db);
  await sql`create index web_events_by_chat on web_events (chat_id, id)`.execute(db);
  // A resent message is acknowledged once (per person, so one person's id can never collide with another's).
  await sql`create unique index web_events_ack_once on web_events (user_id, chat_id, ref)
    where kind = 'ack'`.execute(db);
  await sql`alter table web_events enable row level security`.execute(db);
  await sql`alter table web_events force row level security`.execute(db);
  await sql`create policy own_rows on web_events
    using (user_id = ${ME} and workspace_id = ${WS})
    with check (user_id = ${ME} and workspace_id = ${WS})`.execute(db);
  // 0016's sweep, now also dropping the events of the sessions it removes.
  await sql`create or replace function public.system_sweep_sessions() returns integer
    language sql ${SAFE} as $$
      with gone as (delete from public.sessions where expires_at <= now() returning id),
        dev as (delete from public.devices where channel = 'web'
          and chat_id in (select id::text from gone)),
        ev as (delete from public.web_events where chat_id in (select id::text from gone))
      select count(*)::integer from gone $$`.execute(db);
}
