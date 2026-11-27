import { type Kysely, sql } from 'kysely';

/**
 * `budgets` (0026) is the one source of a person's limit. The older `users.monthly_limit_usd`
 * (0017) is legacy: copied into `budgets` here, left in place and unread. The two functions that
 * took a limit now write `budgets`; same signatures, pinned search_path, and grants.
 */
const SAFE = sql.raw('security definer set search_path = pg_catalog, public, pg_temp');
const ME = sql`nullif(current_setting('app.user_id', true), '')::uuid`;
const WS = sql`nullif(current_setting('app.workspace_id', true), '')::uuid`;

const ADMIN_WORKSPACE = sql`(select u.workspace_id from public.users u where u.id = ${ME}
  and u.role = 'admin' and u.workspace_id = ${WS})`;

/** Copy every legacy per-person limit into `budgets`. Exported so a test can run it on seeded rows. */
export async function copyLegacyLimits(db: Kysely<unknown>): Promise<void> {
  await sql`insert into public.budgets (user_id, workspace_id, monthly_limit_usd)
    select id, workspace_id, monthly_limit_usd from public.users
    where monthly_limit_usd is not null`.execute(db);
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await copyLegacyLimits(db);
  await sql`create or replace function public.admin_create_account(p_email text,
    p_password_hash text, p_limit numeric) returns uuid language plpgsql ${SAFE} as $$
    declare v_ws uuid := ${ADMIN_WORKSPACE}; v_user uuid;
    begin
      if v_ws is null then return null; end if;
      insert into public.users (role, workspace_id) values ('member', v_ws) returning id into v_user;
      insert into public.credentials (user_id, workspace_id, email, password_hash, must_change)
        values (v_user, v_ws, lower(p_email), p_password_hash, true);
      if p_limit is not null then
        insert into public.budgets (user_id, workspace_id, monthly_limit_usd)
          values (v_user, v_ws, p_limit);
      end if;
      return v_user;
    end $$`.execute(db);
  await sql`create or replace function public.system_redeem_invite(p_token_hash text,
    p_email text, p_password_hash text) returns table (user_id uuid, workspace_id uuid)
    language plpgsql ${SAFE} as $$
    #variable_conflict use_column
    declare v_role text; v_ws uuid; v_limit numeric; v_user uuid;
    begin
      update public.invites set used_at = now()
        where token_hash = p_token_hash and used_at is null and expires_at > now()
        returning invites.role, invites.workspace_id, invites.monthly_limit_usd
        into v_role, v_ws, v_limit;
      if v_role is null then return; end if;
      insert into public.users (role, workspace_id, told_admin_can_read_at)
        values (v_role, v_ws, now()) returning id into v_user;
      insert into public.credentials (user_id, workspace_id, email, password_hash)
        values (v_user, v_ws, lower(p_email), p_password_hash);
      if v_limit is not null then
        insert into public.budgets (user_id, workspace_id, monthly_limit_usd)
          values (v_user, v_ws, v_limit);
      end if;
      return query select v_user, v_ws;
    end $$`.execute(db);
}
