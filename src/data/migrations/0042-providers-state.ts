import { type Kysely, sql } from 'kysely';

/**
 * What the admin's providers page reads (M2-15e): the switches in `routes` and the newest message
 * each channel received in the admin's workspace. Turns are under row-level security, so the admin
 * reads them through this named function. A non-admin gets nothing and the refusal is audited.
 */
const SAFE = sql.raw('security definer set search_path = pg_catalog, public, pg_temp');
const ME = sql`nullif(current_setting('app.user_id', true), '')::uuid`;
const WS = sql`nullif(current_setting('app.workspace_id', true), '')::uuid`;
const ADMIN_WS = sql`(select a.workspace_id from public.users a where a.id = ${ME}
  and a.role = 'admin' and a.workspace_id = ${WS})`;
const AUDIT = sql`insert into public.audit_log (channel, chat_id, user_id, workspace_id, tool,
  action_type, changes_state, arg_names, extra_args, args_sha256, decision, outcome)`;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create function public.admin_providers_state()
    returns jsonb language plpgsql ${SAFE} as $$
    #variable_conflict use_column
    declare v_ws uuid := ${ADMIN_WS};
    begin
      if v_ws is null then
        ${AUDIT} values ('web', 'providers', ${ME}, coalesce(${WS},
          '00000000-0000-0000-0000-000000000001'::uuid), 'admin.providers.list', 'admin.route',
          false, '{}', 0, encode(sha256(''::bytea), 'hex'), 'auto', 'refused');
        return null;
      end if;
      return jsonb_build_object(
        'routes', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'enabled', r.enabled)), '[]')
          from public.routes r),
        'channels', (select coalesce(jsonb_agg(jsonb_build_object('id', t.channel,
          'lastMessageAt', t.last)), '[]') from (select channel, max(created_at) as last
          from public.turns where workspace_id = v_ws group by channel) t));
    end $$`.execute(db);
  await sql`revoke execute on function public.admin_providers_state() from public`.execute(db);
}
