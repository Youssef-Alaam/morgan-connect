import { type Kysely, sql } from 'kysely';

/**
 * Parallel-task cap (M2-11): how many turns one person may have running at once. Null means the
 * install default (see src/data/task-cap.ts). The column lives on `users`, which the app role
 * cannot update, so a person cannot raise their own cap: only `admin_set_task_cap` writes it, as
 * the admin on the transaction, and it records an audit row either way (like 0026).
 */
const SAFE = sql.raw('security definer set search_path = pg_catalog, public, pg_temp');
const ME = sql`nullif(current_setting('app.user_id', true), '')::uuid`;
const WS = sql`nullif(current_setting('app.workspace_id', true), '')::uuid`;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table users add column max_parallel_tasks integer
    check (max_parallel_tasks is null or max_parallel_tasks >= 1)`.execute(db);
  await sql`create function public.admin_set_task_cap(p_member uuid, p_cap integer)
    returns boolean language plpgsql ${SAFE} as $$
    declare v_ws uuid; v_ok boolean;
    begin
      select u.workspace_id into v_ws from public.users u
        where u.id = ${ME} and u.role = 'admin' and u.workspace_id = ${WS};
      v_ok := v_ws is not null and (p_cap is null or p_cap >= 1)
        and exists (select 1 from public.users m where m.id = p_member and m.workspace_id = v_ws);
      if v_ok then
        update public.users set max_parallel_tasks = p_cap where id = p_member;
      end if;
      insert into public.audit_log (channel, chat_id, user_id, workspace_id, tool, action_type,
        changes_state, arg_names, extra_args, args_sha256, decision, outcome, subject_user_id)
      values ('admin', 'task-cap', ${ME}, coalesce(v_ws, ${WS}), 'admin.task_cap.set',
        'admin.task_cap', true, '{}', 0,
        encode(sha256(convert_to(coalesce(p_cap::text, ''), 'UTF8')), 'hex'),
        'auto', case when v_ok then 'ok' else 'refused' end, p_member);
      return v_ok;
    end $$`.execute(db);
}
