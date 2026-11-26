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
  // Nobody set on the transaction means nobody may remove anything. The audit row, ok or refused,
  // names the device asked for and is written in the same step. Returns whose device it was, or null.
  await sql`create function public.member_unlink_device(p_device_id uuid) returns uuid
    language plpgsql ${SAFE} as $$
    declare
      v_me uuid := ${ME};
      v_my_ws uuid := ${WS};
      v_owner uuid; v_ws uuid; v_ok boolean;
    begin
      if v_me is null or v_my_ws is null then return null; end if;
      select d.user_id, u.workspace_id into v_owner, v_ws from public.devices d
        join public.users u on u.id = d.user_id
        where d.id = p_device_id and d.channel <> 'web';
      v_ok := v_owner is not null and (v_owner is not distinct from v_me or exists (
        select 1 from public.users a where a.id = v_me and a.role = 'admin'
        and a.workspace_id is not distinct from v_ws and a.workspace_id = v_my_ws));
      if v_ok then delete from public.devices where id = p_device_id; end if;
      insert into public.audit_log (channel, chat_id, user_id, workspace_id, tool, action_type,
        changes_state, arg_names, extra_args, args_sha256, decision, outcome, subject_user_id, reason)
        values ('web', 'device', v_me, v_my_ws, 'device.unlink', 'device.unlink', true, '{}', 0,
        encode(sha256(''::bytea), 'hex'), 'auto', case when v_ok then 'ok' else 'refused' end,
        case when v_ok then v_owner end, p_device_id::text);
      return case when v_ok then v_owner end;
    end $$`.execute(db);
  await sql`revoke execute on function public.member_unlink_device(uuid) from public`.execute(db);
}
