import { type Kysely, sql } from 'kysely';

/**
 * What profile each of a person's chats is set to (M2-9a). A named function, because the admin
 * reads another person's devices, which row-level security would otherwise hide from them. A person
 * may read their own; the admin any in their workspace; nobody else gets a row. Web sessions'
 * devices are left out, as in the device list. The first row is the person (no device).
 */
const SAFE = sql.raw('security definer set search_path = pg_catalog, public, pg_temp');
const ME = sql`nullif(current_setting('app.user_id', true), '')::uuid`;
const WS = sql`nullif(current_setting('app.workspace_id', true), '')::uuid`;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create function public.profiles_overview(p_user uuid)
    returns table (role text, device_id uuid, channel text, preset text)
    language plpgsql stable ${SAFE} as $$
    declare
      v_me uuid := ${ME};
      v_ws uuid := ${WS};
      v_role text;
    begin
      if v_me is null or v_ws is null then return; end if;
      select u.role into v_role from public.users u where u.id = p_user and u.workspace_id = v_ws;
      if v_role is null or (p_user <> v_me and not exists (select 1 from public.users a
        where a.id = v_me and a.role = 'admin' and a.workspace_id = v_ws)) then return; end if;
      return query
        select v_role, null::uuid, null::text, (select a.preset from public.profile_assignments a
          where a.user_id = p_user and a.device_id is null)
        union all
        (select v_role, d.id, d.channel, (select a.preset from public.profile_assignments a
          where a.device_id = d.id) from public.devices d
          where d.user_id = p_user and d.channel <> 'web' order by d.created_at, d.id);
    end $$`.execute(db);
  await sql`revoke execute on function public.profiles_overview(uuid) from public`.execute(db);
}
