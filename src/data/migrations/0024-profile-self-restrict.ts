import { type Kysely, sql } from 'kysely';

/** The admin may not set their own profile to Restricted (M2-9a); checked where the audit row is written. */
const SAFE = sql.raw('security definer set search_path = pg_catalog, public, pg_temp');
const ME = sql`nullif(current_setting('app.user_id', true), '')::uuid`;
const WS = sql`nullif(current_setting('app.workspace_id', true), '')::uuid`;

/** Same function as 0023, plus the self-restrict rule (a refusal is audited like any other). */
async function assignFunction(db: Kysely<unknown>): Promise<void> {
  await sql`create or replace function public.admin_assign_profile(p_user uuid, p_device uuid, p_preset text)
    returns table (role text, person_preset text, device_preset text)
    language plpgsql ${SAFE} as $$
    declare
      v_me uuid := ${ME};
      v_ws uuid := ${WS};
      v_role text; v_person text; v_device text; v_ok boolean;
    begin
      if v_me is null or v_ws is null then return; end if;
      select u.role into v_role from public.users u where u.id = p_user and u.workspace_id = v_ws;
      -- Nobody sets their own profile to Restricted: the admin would lock themselves out.
      v_ok := v_role is not null and not (p_user = v_me and p_preset = 'restricted') and exists (select 1 from public.users a
        where a.id = v_me and a.role = 'admin' and a.workspace_id = v_ws)
        and (p_device is null or exists (select 1 from public.devices d
          where d.id = p_device and d.user_id = p_user and d.channel <> 'web'));
      insert into public.audit_log (channel, chat_id, user_id, workspace_id, tool, action_type,
        changes_state, arg_names, extra_args, args_sha256, decision, outcome, subject_user_id, reason)
        values ('web', 'profile', v_me, v_ws, 'admin.profile.assign', 'admin.profile.assign', true,
        '{}', 0, encode(sha256(''::bytea), 'hex'), 'auto',
        case when v_ok then 'ok' else 'refused' end,
        p_user, p_preset || ' for ' || coalesce(p_device::text, 'person'));
      if v_ok then
        select a.preset into v_person from public.profile_assignments a
          where a.user_id = p_user and a.device_id is null;
        select a.preset into v_device from public.profile_assignments a where a.device_id = p_device;
        if p_device is null then
          insert into public.profile_assignments (user_id, workspace_id, preset)
            values (p_user, v_ws, p_preset)
            on conflict (user_id) where device_id is null do update set preset = excluded.preset;
        else
          insert into public.profile_assignments (user_id, workspace_id, device_id, preset)
            values (p_user, v_ws, p_device, p_preset)
            on conflict (device_id) where device_id is not null
            do update set preset = excluded.preset;
        end if;
      end if;
      if v_ok then return query select v_role, v_person, v_device; end if;
    end $$`.execute(db);
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await assignFunction(db);
}
