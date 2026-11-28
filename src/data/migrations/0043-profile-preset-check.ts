import { type Kysely, sql } from 'kysely';

/**
 * The profile save (migration 0040) checks the preset by name, so an unknown one is refused and
 * audited like any other refusal instead of failing on the foreign key (M2-15b review). The
 * custom modes may only name action types the presets name, and the audit reason is capped at
 * 200 characters. The self-lockout rule is a UX guard (the admin keeps a way to work), not a
 * security boundary.
 */
const SAFE = sql.raw('security definer set search_path = pg_catalog, public, pg_temp');
const ME = sql`nullif(current_setting('app.user_id', true), '')::uuid`;
const WS = sql`nullif(current_setting('app.workspace_id', true), '')::uuid`;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create or replace function public.admin_assign_profile(p_user uuid, p_device uuid,
    p_preset text, p_modes jsonb)
    returns table (role text, person_preset text, device_preset text, person_modes jsonb,
      device_modes jsonb) language plpgsql ${SAFE} as $$
    declare
      v_me uuid := ${ME}; v_ws uuid := ${WS};
      v_role text; v_ok boolean; v_shut boolean; v_pp text; v_dp text; v_pm jsonb; v_dm jsonb;
    begin
      if v_me is null or v_ws is null then return; end if;
      select u.role into v_role from public.users u where u.id = p_user and u.workspace_id = v_ws;
      -- Shut: nothing but reading left on (Restricted, or custom modes that amount to it).
      v_shut := not exists (select 1 from jsonb_each_text(coalesce(p_modes,
        (select p.modes from public.access_profiles p where p.preset = p_preset))) e
        where e.key <> 'read' and e.value <> 'off');
      v_ok := v_role is not null and not (p_user = v_me and v_shut)
        and exists (select 1 from public.access_profiles p where p.preset = p_preset)
        and (p_modes is null or (jsonb_typeof(p_modes) = 'object' and not exists (
          select 1 from jsonb_each_text(p_modes) e where e.value not in ('off', 'ask', 'auto')
          or not exists (select 1 from public.access_profiles k where k.modes ? e.key))))
        and exists (select 1 from public.users a
          where a.id = v_me and a.role = 'admin' and a.workspace_id = v_ws)
        and (p_device is null or exists (select 1 from public.devices d
          where d.id = p_device and d.user_id = p_user and d.channel <> 'web'));
      insert into public.audit_log (channel, chat_id, user_id, workspace_id, tool, action_type,
        changes_state, arg_names, extra_args, args_sha256, decision, outcome, subject_user_id, reason)
        values ('web', 'profile', v_me, v_ws, 'admin.profile.assign', 'admin.profile.assign', true,
        '{}', 0, encode(sha256(''::bytea), 'hex'), 'auto',
        case when v_ok then 'ok' else 'refused' end, p_user, left(coalesce('custom ' || p_modes::text,
        p_preset) || ' for ' || coalesce(p_device::text, 'person'), 200));
      if not v_ok then return; end if;
      select a.preset, a.modes into v_pp, v_pm from public.profile_assignments a
        where a.user_id = p_user and a.device_id is null;
      select a.preset, a.modes into v_dp, v_dm from public.profile_assignments a where a.device_id = p_device;
      if p_device is null then
        insert into public.profile_assignments (user_id, workspace_id, preset, modes)
          values (p_user, v_ws, p_preset, p_modes)
          on conflict (user_id) where device_id is null
          do update set preset = excluded.preset, modes = excluded.modes;
      else
        insert into public.profile_assignments (user_id, workspace_id, device_id, preset, modes)
          values (p_user, v_ws, p_device, p_preset, p_modes)
          on conflict (device_id) where device_id is not null
          do update set preset = excluded.preset, modes = excluded.modes;
      end if;
      return query select v_role, v_pp, v_dp, v_pm, v_dm;
    end $$`.execute(db);
  await sql`revoke execute on function
    public.admin_assign_profile(uuid, uuid, text, jsonb) from public`.execute(db);
}
