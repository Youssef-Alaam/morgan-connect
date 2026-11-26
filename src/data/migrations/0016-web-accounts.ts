import { type Kysely, sql } from 'kysely';

/**
 * Web accounts and sessions (M2-5a): each table carries user_id and workspace_id under the same
 * RLS as every user-data table. Lookups before a person is known are named functions run as their
 * owner, like 0012. Only hashes are stored: scrypt for passwords, sha256 for tokens.
 */
const SAFE = sql.raw('security definer set search_path = pg_catalog, public, pg_temp');
const ME = sql`nullif(current_setting('app.user_id', true), '')::uuid`;
const WS = sql`nullif(current_setting('app.workspace_id', true), '')::uuid`;
const PERSON = sql`user_id uuid not null, workspace_id uuid not null,
  foreign key (user_id, workspace_id) references users (id, workspace_id)`;

async function lock(db: Kysely<unknown>, table: string): Promise<void> {
  await sql`alter table ${sql.table(table)} enable row level security`.execute(db);
  await sql`alter table ${sql.table(table)} force row level security`.execute(db);
  await sql`create policy own_rows on ${sql.table(table)}
    using (user_id = ${ME} and workspace_id = ${WS})
    with check (user_id = ${ME} and workspace_id = ${WS})`.execute(db);
}

async function createTables(db: Kysely<unknown>): Promise<void> {
  // One password login per person; the email is kept lower-case and is unique install-wide.
  await sql`create table credentials (user_id uuid primary key,
    workspace_id uuid not null, email text not null unique check (email = lower(email)),
    password_hash text not null, created_at timestamptz not null default now(),
    foreign key (user_id, workspace_id) references users (id, workspace_id))`.execute(db);
  // A browser session; its `web` device row (chat_id = this id) is made with it.
  await sql`create table sessions (id uuid primary key default gen_random_uuid(), ${PERSON},
    token_hash text not null unique, created_at timestamptz not null default now(),
    expires_at timestamptz not null)`.execute(db);
  // The link that lets a person set their first password: single use, with an expiry.
  await sql`create table password_links (id uuid primary key default gen_random_uuid(), ${PERSON},
    token_hash text not null unique, created_at timestamptz not null default now(),
    expires_at timestamptz not null, used_at timestamptz)`.execute(db);
  for (const table of ['credentials', 'sessions', 'password_links']) await lock(db, table);
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await createTables(db);
  await sql`create function public.system_credentials_by_email(p_email text)
    returns table (user_id uuid, workspace_id uuid, password_hash text) language sql stable ${SAFE} as $$
      select c.user_id, c.workspace_id, c.password_hash from public.credentials c
      where c.email = lower(p_email) $$`.execute(db);
  await sql`create function public.system_session_owner(p_token_hash text)
    returns table (user_id uuid, workspace_id uuid, session_id uuid) language sql stable ${SAFE} as $$
      select s.user_id, s.workspace_id, s.id from public.sessions s
      where s.token_hash = p_token_hash and s.expires_at > now() $$`.execute(db);
  // Housekeeping with no person: drop sessions past their time, with their web devices.
  await sql`create function public.system_sweep_sessions() returns integer
    language sql ${SAFE} as $$
      with gone as (delete from public.sessions where expires_at <= now() returning id),
        dev as (delete from public.devices where channel = 'web'
          and chat_id in (select id::text from gone))
      select count(*)::integer from gone $$`.execute(db);
  // The admin's first-password link; only while the admin has no password, replacing any older one.
  // Trust boundary: takes a token HASH, returns only a boolean, and serves the install's one admin
  // (users_single_admin) and no one else; the plain token exists only in the caller and the log.
  await sql`create function public.system_issue_admin_link(p_token_hash text, p_ttl_seconds integer)
    returns boolean language plpgsql ${SAFE} as $$
    declare v_user uuid; v_ws uuid;
    begin
      select u.id, u.workspace_id into v_user, v_ws from public.users u where u.role = 'admin' limit 1;
      if v_user is null or exists (select 1 from public.credentials c where c.user_id = v_user)
        then return false; end if;
      delete from public.password_links where user_id = v_user and used_at is null;
      insert into public.password_links (user_id, workspace_id, token_hash, expires_at)
        values (v_user, v_ws, p_token_hash, now() + make_interval(secs => p_ttl_seconds));
      return true;
    end $$`.execute(db);
  // Read only: is this link still unspent and unexpired? Lets the caller refuse before hashing.
  await sql`create function public.system_link_live(p_token_hash text) returns boolean
    language sql stable ${SAFE} as $$ select exists (select 1 from public.password_links
      where token_hash = p_token_hash and used_at is null and expires_at > now()) $$`.execute(db);
  // One step: spend the link and create the login, or neither.
  await sql`create function public.system_redeem_link(p_token_hash text, p_email text, p_password_hash text)
    returns table (user_id uuid, workspace_id uuid) language plpgsql ${SAFE} as $$
    #variable_conflict use_column
    declare v_user uuid; v_ws uuid;
    begin
      update public.password_links set used_at = now()
        where token_hash = p_token_hash and used_at is null and expires_at > now()
        returning password_links.user_id, password_links.workspace_id into v_user, v_ws;
      if v_user is null then return; end if;
      insert into public.credentials (user_id, workspace_id, email, password_hash)
        values (v_user, v_ws, lower(p_email), p_password_hash);
      return query select v_user, v_ws;
    end $$`.execute(db);
}
