import { type Kysely, sql } from 'kysely';

/**
 * Invites and temporary passwords (M2-5b). An invite is keyed to the admin who made it; spending
 * it happens before the person is known, so it is a named function (like 0012). Only the token's
 * hash is stored. The admin's read path now refuses anyone never told (D59).
 */
const SAFE = sql.raw('security definer set search_path = pg_catalog, public, pg_temp');
const ME = sql`nullif(current_setting('app.user_id', true), '')::uuid`;
const WS = sql`nullif(current_setting('app.workspace_id', true), '')::uuid`;

async function createInvites(db: Kysely<unknown>): Promise<void> {
  await sql`alter table users add column monthly_limit_usd numeric(12, 2) check (monthly_limit_usd >= 0)`.execute(
    db,
  );
  await sql`alter table credentials add column must_change boolean not null default false`.execute(
    db,
  );
  await sql`create table invites (id uuid primary key default gen_random_uuid(),
    user_id uuid not null, workspace_id uuid not null,
    token_hash text not null unique, role text not null check (role in ('member')),
    monthly_limit_usd numeric(12, 2) check (monthly_limit_usd >= 0),
    created_at timestamptz not null default now(), expires_at timestamptz not null, used_at timestamptz,
    foreign key (user_id, workspace_id) references users (id, workspace_id))`.execute(db);
  await sql`alter table invites enable row level security`.execute(db);
  await sql`alter table invites force row level security`.execute(db);
  await sql`create policy own_rows on invites
    using (user_id = ${ME} and workspace_id = ${WS})
    with check (user_id = ${ME} and workspace_id = ${WS})`.execute(db);
}

const ADMIN_WORKSPACE = sql`(select u.workspace_id from public.users u where u.id = ${ME}
  and u.role = 'admin' and u.workspace_id = ${WS})`;

async function createAdminFunctions(db: Kysely<unknown>): Promise<void> {
  // Trust boundary: acts only as the person set on the transaction, and only if they are an admin.
  await sql`create function public.admin_create_invite(p_token_hash text, p_ttl_seconds integer,
    p_limit numeric) returns boolean language plpgsql ${SAFE} as $$
    declare v_ws uuid := ${ADMIN_WORKSPACE};
    begin
      if v_ws is null then return false; end if;
      insert into public.invites (user_id, workspace_id, token_hash, role, monthly_limit_usd, expires_at)
        values (${ME}, v_ws, p_token_hash, 'member', p_limit, now() + make_interval(secs => p_ttl_seconds));
      return true;
    end $$`.execute(db);
  // A member with a temporary password, which must be changed at once.
  await sql`create function public.admin_create_account(p_email text, p_password_hash text,
    p_limit numeric) returns uuid language plpgsql ${SAFE} as $$
    declare v_ws uuid := ${ADMIN_WORKSPACE}; v_user uuid;
    begin
      if v_ws is null then return null; end if;
      insert into public.users (role, workspace_id, monthly_limit_usd) values ('member', v_ws, p_limit)
        returning id into v_user;
      insert into public.credentials (user_id, workspace_id, email, password_hash, must_change)
        values (v_user, v_ws, lower(p_email), p_password_hash, true);
      return v_user;
    end $$`.execute(db);
  // The person set on the transaction says they were told; it touches their own row and nothing else.
  await sql`create function public.member_accept_notice() returns void language sql ${SAFE} as $$
    update public.users set told_admin_can_read_at = coalesce(told_admin_can_read_at, now())
      where id = ${ME} and workspace_id = ${WS} $$`.execute(db);
}

async function createSystemFunctions(db: Kysely<unknown>): Promise<void> {
  await sql`create function public.system_invite_live(p_token_hash text) returns boolean
    language sql stable ${SAFE} as $$ select exists (select 1 from public.invites
      where token_hash = p_token_hash and used_at is null and expires_at > now()) $$`.execute(db);
  // One step: spend the invite, create the person (already told) and their login, or none of it.
  await sql`create function public.system_redeem_invite(p_token_hash text, p_email text,
    p_password_hash text) returns table (user_id uuid, workspace_id uuid) language plpgsql ${SAFE} as $$
    #variable_conflict use_column
    declare v_role text; v_ws uuid; v_limit numeric; v_user uuid;
    begin
      update public.invites set used_at = now()
        where token_hash = p_token_hash and used_at is null and expires_at > now()
        returning invites.role, invites.workspace_id, invites.monthly_limit_usd into v_role, v_ws, v_limit;
      if v_role is null then return; end if;
      insert into public.users (role, workspace_id, monthly_limit_usd, told_admin_can_read_at)
        values (v_role, v_ws, v_limit, now()) returning id into v_user;
      insert into public.credentials (user_id, workspace_id, email, password_hash)
        values (v_user, v_ws, lower(p_email), p_password_hash);
      return query select v_user, v_ws;
    end $$`.execute(db);
  await sql`drop function public.system_session_owner(text)`.execute(db);
  await sql`create function public.system_session_owner(p_token_hash text)
    returns table (user_id uuid, workspace_id uuid, session_id uuid, must_change boolean)
    language sql stable ${SAFE} as $$
      select s.user_id, s.workspace_id, s.id, c.must_change from public.sessions s
      join public.credentials c on c.user_id = s.user_id
      where s.token_hash = p_token_hash and s.expires_at > now() $$`.execute(db);
}

/** admin_read_gate (0015) with one more rule: the member must have been told (D59). */
async function requireTold(db: Kysely<unknown>): Promise<void> {
  await sql`create or replace function public.admin_read_gate(p_kind text, p_admin uuid,
    p_member uuid, p_reason text) returns uuid language plpgsql ${SAFE} as $$
    declare
      v_role text;
      v_ws uuid;
      v_ok boolean;
      v_me uuid := nullif(current_setting('app.user_id', true), '')::uuid;
      v_my_ws uuid := nullif(current_setting('app.workspace_id', true), '')::uuid;
    begin
      select u.role, u.workspace_id into v_role, v_ws from public.users u where u.id = p_admin;
      v_ok := v_role = 'admin'
        and p_admin = v_me
        and v_ws = v_my_ws
        and btrim(coalesce(p_reason, '')) <> ''
        and exists (select 1 from public.users m where m.id = p_member and m.workspace_id = v_ws
          and m.told_admin_can_read_at is not null);
      insert into public.audit_log (channel, chat_id, user_id, workspace_id, tool, action_type,
        changes_state, arg_names, extra_args, args_sha256, decision, outcome, subject_user_id, reason)
      values ('admin', 'read', v_me,
        coalesce(v_my_ws, '00000000-0000-0000-0000-000000000001'::uuid), 'admin.read.' || p_kind,
        'admin.read', false, '{}', 0,
        encode(sha256(convert_to(coalesce(p_reason, ''), 'UTF8')), 'hex'), 'auto',
        case when v_ok then 'ok' else 'refused' end, p_member, p_reason);
      return case when v_ok then v_ws end;
    end $$`.execute(db);
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await createInvites(db);
  await createAdminFunctions(db);
  await createSystemFunctions(db);
  await requireTold(db);
  await sql`revoke execute on function public.admin_create_invite(text, integer, numeric),
    public.admin_create_account(text, text, numeric), public.member_accept_notice(),
    public.system_invite_live(text), public.system_redeem_invite(text, text, text),
    public.system_session_owner(text) from public`.execute(db);
}
