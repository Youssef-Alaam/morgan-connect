import { type Kysely, sql } from 'kysely';

/**
 * The admin's audit log viewer (M2-15d): one read-only, paged list of the whole workspace's audit
 * rows, filtered by person, action type, decision, outcome and dates. Row-level security shows a
 * person only their own rows, so the admin reads through this named function. Rows are numbered in
 * the order they were written and pages go by "older than this row", so a page does not move when
 * new rows arrive. A non-admin gets nothing and the refusal is audited. There is no way to change
 * or remove a row from here: the function only selects.
 */
const SAFE = sql.raw('security definer set search_path = pg_catalog, public, pg_temp');
const ME = sql`nullif(current_setting('app.user_id', true), '')::uuid`;
const WS = sql`nullif(current_setting('app.workspace_id', true), '')::uuid`;
const ADMIN_WS = sql`(select a.workspace_id from public.users a where a.id = ${ME}
  and a.role = 'admin' and a.workspace_id = ${WS})`;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create function public.admin_list_audit(p_user uuid, p_action text, p_decision text,
    p_outcome text, p_from timestamptz, p_to timestamptz, p_before bigint, p_limit integer)
    returns jsonb language plpgsql ${SAFE} as $$
    #variable_conflict use_column
    declare
      v_ws uuid := ${ADMIN_WS};
      v_n integer := least(greatest(coalesce(p_limit, 50), 1), 100);
      v_rows jsonb; v_more boolean; v_actions jsonb;
    begin
      if v_ws is null then
        insert into public.audit_log (channel, chat_id, user_id, workspace_id, tool, action_type,
          changes_state, arg_names, extra_args, args_sha256, decision, outcome)
          values ('web', 'audit', ${ME}, coalesce(${WS}, '00000000-0000-0000-0000-000000000001'::uuid),
          'admin.audit.list', 'admin.audit', false, '{}', 0, encode(sha256(''::bytea), 'hex'),
          'auto', 'refused');
        return null;
      end if;
      with f as (select a.* from public.audit_log a where a.workspace_id = v_ws
          and (p_user is null or a.user_id = p_user or a.subject_user_id = p_user)
          and (p_action is null or a.action_type = p_action)
          and (p_decision is null or a.decision = p_decision)
          and (p_outcome is null or a.outcome = p_outcome)
          and (p_from is null or a.created_at >= p_from) and (p_to is null or a.created_at < p_to)
          and (p_before is null or a.id < p_before)
          order by a.id desc limit v_n + 1),
        p as (select * from f order by id desc limit v_n)
      select coalesce(jsonb_agg(jsonb_build_object('id', p.id::text, 'at', p.created_at,
          'personId', p.user_id, 'person', c.email, 'subjectId', p.subject_user_id,
          'subject', s.email, 'channel', p.channel, 'tool', p.tool, 'actionType', p.action_type,
          'decision', p.decision, 'outcome', p.outcome, 'reason', p.reason)
          order by p.id desc), '[]'), (select count(*) from f) > v_n
        into v_rows, v_more from p
        left join public.credentials c on c.user_id = p.user_id
        left join public.credentials s on s.user_id = p.subject_user_id;
      select coalesce(jsonb_agg(t.action_type order by t.action_type), '[]') into v_actions
        from (select distinct x.action_type from public.audit_log x where x.workspace_id = v_ws) t;
      return jsonb_build_object('rows', v_rows, 'more', v_more, 'actions', v_actions);
    end $$`.execute(db);
  await sql`revoke execute on function public.admin_list_audit(uuid, text, text, text,
    timestamptz, timestamptz, bigint, integer) from public`.execute(db);
}
