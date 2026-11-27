import { type Kysely, sql } from 'kysely';

/**
 * The admin's people list and invite revoking (M2-15a). Named functions, because the admin reads
 * other people's rows, which row-level security would otherwise hide. A non-admin gets no rows and
 * a revoke by a non-admin deletes nothing. Revoking writes its audit row in the same step.
 */
const SAFE = sql.raw('security definer set search_path = pg_catalog, public, pg_temp');
const ME = sql`nullif(current_setting('app.user_id', true), '')::uuid`;
const WS = sql`nullif(current_setting('app.workspace_id', true), '')::uuid`;
const ADMIN_WS = sql`(select a.workspace_id from public.users a where a.id = ${ME}
  and a.role = 'admin' and a.workspace_id = ${WS})`;

export async function up(db: Kysely<unknown>): Promise<void> {
  // One row per person, then one per linked chat (web sessions are left out, as in the device list).
  await sql`create function public.admin_list_people()
    returns table (user_id uuid, role text, email text, must_change boolean, created_at timestamptz,
      device_id uuid, channel text, device_created_at timestamptz)
    language plpgsql stable ${SAFE} as $$
    #variable_conflict use_column
    declare v_ws uuid := ${ADMIN_WS};
    begin
      if v_ws is null then return; end if;
      return query
        select u.id, u.role, c.email, coalesce(c.must_change, false), u.created_at,
          d.id, d.channel, d.created_at
        from public.users u
        left join public.credentials c on c.user_id = u.id
        left join public.devices d on d.user_id = u.id and d.channel <> 'web'
        where u.workspace_id = v_ws order by u.created_at, u.id, d.created_at, d.id;
    end $$`.execute(db);
  // Every open invite in the admin's workspace (not only the ones this admin made), as revoke matches.
  await sql`create function public.admin_list_invites()
    returns table (id uuid, monthly_limit_usd numeric, created_at timestamptz, expires_at timestamptz)
    language plpgsql stable ${SAFE} as $$
    #variable_conflict use_column
    declare v_ws uuid := ${ADMIN_WS};
    begin
      if v_ws is null then return; end if;
      return query select i.id, i.monthly_limit_usd, i.created_at, i.expires_at from public.invites i
        where i.workspace_id = v_ws and i.used_at is null and i.expires_at > now()
        order by i.created_at desc, i.id;
    end $$`.execute(db);
  // An invite not yet used goes; a used one is a person now and stays. False when nothing went.
  await sql`create function public.admin_revoke_invite(p_invite_id uuid) returns boolean
    language plpgsql ${SAFE} as $$
    declare v_ws uuid := ${ADMIN_WS}; v_ok boolean := false;
    begin
      if v_ws is not null then
        delete from public.invites where id = p_invite_id and workspace_id = v_ws and used_at is null;
        v_ok := found;
      end if;
      insert into public.audit_log (channel, chat_id, user_id, workspace_id, tool, action_type,
        changes_state, arg_names, extra_args, args_sha256, decision, outcome, reason)
        values ('web', 'invite', ${ME}, coalesce(${WS}, '00000000-0000-0000-0000-000000000001'::uuid),
        'admin.invite.revoke', 'admin.invite.revoke', true, '{}', 0, encode(sha256(''::bytea), 'hex'),
        'auto', case when v_ok then 'ok' else 'refused' end, p_invite_id::text);
      return v_ok;
    end $$`.execute(db);
  await sql`revoke execute on function public.admin_list_people(), public.admin_list_invites(),
    public.admin_revoke_invite(uuid) from public`.execute(db);
}
