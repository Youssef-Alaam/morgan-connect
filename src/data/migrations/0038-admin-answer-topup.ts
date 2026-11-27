import { type Kysely, sql } from 'kysely';

/**
 * The admin answers a top-up request from the page (M2-15c). The request's question is the
 * ordinary `approvals` row made for Telegram (0031), so this answers that same row: it takes the
 * approval from pending to used (approved) or denied in one step with the request, and a request
 * already answered on Telegram, or lapsed, gives nothing back. Whichever side answers first wins,
 * and the other finds the approval spent. Admin only, own workspace; the answer or the refusal is
 * audited in the same step.
 */
const SAFE = sql.raw('security definer set search_path = pg_catalog, public, pg_temp');
const ME = sql`nullif(current_setting('app.user_id', true), '')::uuid`;
const WS = sql`nullif(current_setting('app.workspace_id', true), '')::uuid`;
const AUDIT = sql`insert into public.audit_log (channel, chat_id, user_id, workspace_id, tool,
  action_type, changes_state, arg_names, extra_args, args_sha256, decision, outcome, subject_user_id)`;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create function public.admin_answer_topup(p_id uuid, p_status text)
    returns table (member_id uuid, amount numeric, channel text, chat_id text)
    language plpgsql ${SAFE} as $$
    #variable_conflict use_column
    declare v_ws uuid; v_row public.budget_topups; v_hash text;
    begin
      select u.workspace_id into v_ws from public.users u
        where u.id = ${ME} and u.role = 'admin' and u.workspace_id = ${WS};
      if v_ws is not null and p_status in ('approved', 'refused') then
        select * into v_row from public.budget_topups t where t.id = p_id
          and t.workspace_id = v_ws and t.status = 'open' and t.expires_at > now() for update;
        if v_row.id is not null then
          update public.approvals set status = case when p_status = 'approved' then 'used'
              else 'denied' end, decided_at = now()
            where id = v_row.approval_id and status = 'pending' returning args_sha256 into v_hash;
          if v_hash is not null then
            update public.budget_topups set status = p_status, decided_at = now() where id = p_id;
          end if;
        end if;
      end if;
      ${AUDIT} values ('web', 'budget', ${ME}, coalesce(v_ws, ${WS},
        '00000000-0000-0000-0000-000000000001'::uuid), 'admin.budget.topup', 'admin.budget', true,
        '{}', 0, coalesce(v_hash, encode(sha256(''::bytea), 'hex')), 'auto',
        case when v_hash is null then 'refused' when p_status = 'approved' then 'ok'
          else 'denied' end, v_row.user_id);
      if v_hash is null then return; end if;
      return query select v_row.user_id, v_row.amount_usd, v_row.channel, v_row.chat_id;
    end $$`.execute(db);
  await sql`revoke execute on function public.admin_answer_topup(uuid, text) from public`.execute(
    db,
  );
}
