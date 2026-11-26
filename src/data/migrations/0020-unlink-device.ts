import { type Kysely, sql } from 'kysely';

/**
 * Unlinking a chat (M2-8). A named function, because the admin may remove a device that is not
 * theirs, which row-level security would otherwise hide from them. Web sessions' devices are never
 * removed this way: they go with their session.
 */
const SAFE = sql.raw('security definer set search_path = pg_catalog, public, pg_temp');
const ME = sql`nullif(current_setting('app.user_id', true), '')::uuid`;
const WS = sql`nullif(current_setting('app.workspace_id', true), '')::uuid`;

export async function up(db: Kysely<unknown>): Promise<void> {
  // The person set on the transaction may remove their own chat; the admin, any in their workspace.
  // Returns whose device it was, or null when there is none or the caller may not remove it.
  await sql`create function public.member_unlink_device(p_device_id uuid) returns uuid
    language plpgsql ${SAFE} as $$
    declare v_owner uuid; v_ws uuid;
    begin
      select d.user_id, u.workspace_id into v_owner, v_ws from public.devices d
        join public.users u on u.id = d.user_id
        where d.id = p_device_id and d.channel <> 'web';
      if v_owner is null then return null; end if;
      if v_owner <> ${ME} and not exists (select 1 from public.users a where a.id = ${ME}
        and a.role = 'admin' and a.workspace_id = v_ws and a.workspace_id = ${WS}) then return null; end if;
      delete from public.devices where id = p_device_id;
      return v_owner;
    end $$`.execute(db);
  await sql`revoke execute on function public.member_unlink_device(uuid) from public`.execute(db);
}
