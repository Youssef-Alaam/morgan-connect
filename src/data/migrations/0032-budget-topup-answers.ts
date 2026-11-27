import { type Kysely, sql } from 'kysely';

/**
 * The admin's side of a top-up (M2-10b, after 0031): find the open request behind a question they
 * were sent, then approve or refuse it. Both act only as the admin on the transaction, in their own
 * workspace; the answer is audited in the same step.
 */
const SAFE = sql.raw('security definer set search_path = pg_catalog, public, pg_temp');
const ME = sql`nullif(current_setting('app.user_id', true), '')::uuid`;
const WS = sql`nullif(current_setting('app.workspace_id', true), '')::uuid`;

const AUDIT = sql`insert into public.audit_log (channel, chat_id, user_id, workspace_id, tool,
  action_type, changes_state, arg_names, extra_args, args_sha256, decision, outcome, subject_user_id)`;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create function public.admin_open_topup(p_approval uuid)
    returns table (topup_id uuid, member_id uuid, amount numeric, month text)
    language sql stable ${SAFE} as $$
      select t.id, t.user_id, t.amount_usd, t.month from public.budget_topups t
        join public.users a on a.id = ${ME} and a.role = 'admin' and a.workspace_id = ${WS}
        where t.approval_id = p_approval and t.status = 'open' and t.workspace_id = a.workspace_id
    $$`.execute(db);
  await sql`create function public.admin_resolve_topup(p_id uuid, p_status text)
    returns table (member_id uuid, amount numeric, channel text, chat_id text)
    language plpgsql ${SAFE} as $$
    #variable_conflict use_column
    declare v_ws uuid; v_row public.budget_topups;
    begin
      select u.workspace_id into v_ws from public.users u
        where u.id = ${ME} and u.role = 'admin' and u.workspace_id = ${WS};
      if v_ws is null or p_status not in ('approved', 'refused') then return; end if;
      update public.budget_topups set status = p_status, decided_at = now()
        where id = p_id and status = 'open' and workspace_id = v_ws returning * into v_row;
      if v_row.id is null then return; end if;
      ${AUDIT} values ('admin', 'budget', ${ME}, v_ws, 'admin.budget.topup', 'admin.budget', true,
        '{}', 0, encode(sha256(convert_to(v_row.amount_usd::text, 'UTF8')), 'hex'), 'auto',
        case when p_status = 'approved' then 'ok' else 'denied' end, v_row.user_id);
      return query select v_row.user_id, v_row.amount_usd, v_row.channel, v_row.chat_id;
    end $$`.execute(db);
}
