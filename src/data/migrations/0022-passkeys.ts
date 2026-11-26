import { type Kysely, sql } from 'kysely';

/**
 * Passkeys (M2-7): one row per registered authenticator, under the same RLS as every user-data
 * table. A passkey sign-in starts before a person is known, so one named function (like 0016)
 * finds the row by its credential id; it returns public data only, never anything secret.
 */
const SAFE = sql.raw('security definer set search_path = pg_catalog, public, pg_temp');
const ME = sql`nullif(current_setting('app.user_id', true), '')::uuid`;
const WS = sql`nullif(current_setting('app.workspace_id', true), '')::uuid`;

export async function up(db: Kysely<unknown>): Promise<void> {
  // `credential_id` and `public_key` are base64url; `counter` is the authenticator's signature count.
  await sql`create table passkeys (id uuid primary key default gen_random_uuid(),
    user_id uuid not null, workspace_id uuid not null, credential_id text not null unique,
    public_key text not null, counter bigint not null default 0, transports text[],
    name text not null, created_at timestamptz not null default now(), last_used_at timestamptz,
    foreign key (user_id, workspace_id) references users (id, workspace_id))`.execute(db);
  await sql`alter table passkeys enable row level security`.execute(db);
  await sql`alter table passkeys force row level security`.execute(db);
  await sql`create policy own_rows on passkeys
    using (user_id = ${ME} and workspace_id = ${WS})
    with check (user_id = ${ME} and workspace_id = ${WS})`.execute(db);
  // Trust boundary: takes a credential id, returns that one passkey's public data and its owner.
  await sql`create function public.system_passkey_by_credential(p_credential_id text)
    returns table (user_id uuid, workspace_id uuid, public_key text, counter bigint, transports text[])
    language sql stable ${SAFE} as $$
      select p.user_id, p.workspace_id, p.public_key, p.counter, p.transports
      from public.passkeys p where p.credential_id = p_credential_id $$`.execute(db);
}
