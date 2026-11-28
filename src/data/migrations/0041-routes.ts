import { type Kysely, sql } from 'kysely';

/**
 * Engine routes switched on or off (M2-15e). The routes themselves come from config; this table
 * holds only the switch. It has no person in it, so it is on the exempt list: the app role may read
 * it (a turn checks its route before the model call) but only `admin_set_route` writes it, in the
 * same step as the audit row. A route with no row is on.
 */
const SAFE = sql.raw('security definer set search_path = pg_catalog, public, pg_temp');
const ME = sql`nullif(current_setting('app.user_id', true), '')::uuid`;
const WS = sql`nullif(current_setting('app.workspace_id', true), '')::uuid`;
const ADMIN_WS = sql`(select a.workspace_id from public.users a where a.id = ${ME}
  and a.role = 'admin' and a.workspace_id = ${WS})`;
const AUDIT = sql`insert into public.audit_log (channel, chat_id, user_id, workspace_id, tool,
  action_type, changes_state, arg_names, extra_args, args_sha256, decision, outcome)`;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create table routes (id text primary key check (id ~ '^[a-z0-9-]{1,40}$'),
    enabled boolean not null default true, updated_at timestamptz not null default now())`.execute(
    db,
  );
  await sql`create function public.admin_set_route(p_id text, p_enabled boolean)
    returns boolean language plpgsql ${SAFE} as $$
    declare v_ws uuid := ${ADMIN_WS}; v_ok boolean := v_ws is not null and p_id ~ '^[a-z0-9-]{1,40}$';
    begin
      if v_ok then
        insert into public.routes (id, enabled) values (p_id, p_enabled)
          on conflict (id) do update set enabled = excluded.enabled, updated_at = now();
      end if;
      ${AUDIT} values ('web', 'providers', ${ME}, coalesce(v_ws, ${WS},
        '00000000-0000-0000-0000-000000000001'::uuid), 'admin.route.set', 'admin.route', true,
        '{}', 0, encode(sha256(convert_to(coalesce(p_id, '') || ':' || p_enabled::text, 'UTF8')),
        'hex'), 'auto', case when v_ok then 'ok' else 'refused' end);
      return v_ok;
    end $$`.execute(db);
  await sql`revoke execute on function public.admin_set_route(text, boolean) from public`.execute(
    db,
  );
}
