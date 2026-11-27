import { type Kysely, sql } from 'kysely';

/**
 * The admin's top-up tools (M2-15c, after 0036 added `users.topup_amount_usd`): set the step one
 * person's approved top-up adds (null goes back to the install's), and list the requests still
 * waiting for an answer. Both act only as the admin on the transaction, in their workspace; the
 * setter writes its audit row either way, like `admin_set_task_cap` (0028).
 */
const SAFE = sql.raw('security definer set search_path = pg_catalog, public, pg_temp');
const ME = sql`nullif(current_setting('app.user_id', true), '')::uuid`;
const WS = sql`nullif(current_setting('app.workspace_id', true), '')::uuid`;
const ADMIN_WS = sql`(select a.workspace_id from public.users a where a.id = ${ME}
  and a.role = 'admin' and a.workspace_id = ${WS})`;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create function public.admin_set_topup_amount(p_member uuid, p_amount numeric)
    returns boolean language plpgsql ${SAFE} as $$
    declare v_ws uuid := ${ADMIN_WS}; v_ok boolean;
    begin
      v_ok := v_ws is not null and (p_amount is null or p_amount > 0)
        and exists (select 1 from public.users m where m.id = p_member and m.workspace_id = v_ws);
      if v_ok then
        update public.users set topup_amount_usd = p_amount where id = p_member;
      end if;
      insert into public.audit_log (channel, chat_id, user_id, workspace_id, tool, action_type,
        changes_state, arg_names, extra_args, args_sha256, decision, outcome, subject_user_id)
      values ('admin', 'topup-step', ${ME}, coalesce(v_ws, ${WS}), 'admin.topup_step.set',
        'admin.budget', true, '{}', 0,
        encode(sha256(convert_to(coalesce(p_amount::text, ''), 'UTF8')), 'hex'),
        'auto', case when v_ok then 'ok' else 'refused' end, p_member);
      return v_ok;
    end $$`.execute(db);
  await sql`create function public.admin_list_topups()
    returns table (id uuid, member_id uuid, email text, amount numeric, month text,
      created_at timestamptz, expires_at timestamptz)
    language plpgsql stable ${SAFE} as $$
    #variable_conflict use_column
    declare v_ws uuid := ${ADMIN_WS};
    begin
      if v_ws is null then return; end if;
      return query select t.id, t.user_id, c.email, t.amount_usd, t.month, t.created_at, t.expires_at
        from public.budget_topups t left join public.credentials c on c.user_id = t.user_id
        where t.workspace_id = v_ws and t.status = 'open' and t.expires_at > now()
        order by t.created_at, t.id;
    end $$`.execute(db);
  await sql`revoke execute on function public.admin_set_topup_amount(uuid, numeric),
    public.admin_list_topups() from public`.execute(db);
}
