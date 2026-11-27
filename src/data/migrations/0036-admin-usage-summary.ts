import { type Kysely, sql } from 'kysely';

/**
 * The admin's budgets page (M2-15c): every person's spend this local month against their limit, in
 * one read. A named function, because the admin reads other people's ledger rows, which
 * row-level security would otherwise hide. It writes one audit row either way (a refused one for a
 * non-admin, who gets no rows). The month's edges come from the local clock in `p_tz`, as in the
 * usage command, so a call just after local midnight counts for the new month.
 */
const SAFE = sql.raw('security definer set search_path = pg_catalog, public, pg_temp');
const ME = sql`nullif(current_setting('app.user_id', true), '')::uuid`;
const WS = sql`nullif(current_setting('app.workspace_id', true), '')::uuid`;
const ADMIN_WS = sql`(select a.workspace_id from public.users a where a.id = ${ME}
  and a.role = 'admin' and a.workspace_id = ${WS})`;

export async function up(db: Kysely<unknown>): Promise<void> {
  // The step an approved top-up adds for this person; null: the install's TOPUP_AMOUNT_USD. Only a
  // named admin function writes it (the app role cannot update users).
  await sql`alter table users add column topup_amount_usd numeric(14, 8)
    check (topup_amount_usd is null or topup_amount_usd > 0)`.execute(db);
  await sql`create function public.admin_usage_summary(p_now timestamptz, p_tz text)
    returns table (user_id uuid, role text, email text, limit_usd numeric, task_cap integer,
      topup_step numeric, topup_usd numeric, spent_usd numeric, calls bigint, month text)
    language plpgsql ${SAFE} as $$
    #variable_conflict use_column
    declare v_ws uuid := ${ADMIN_WS}; v_local timestamp := p_now at time zone p_tz;
      v_start timestamptz := date_trunc('month', v_local) at time zone p_tz;
      v_end timestamptz := (date_trunc('month', v_local) + interval '1 month') at time zone p_tz;
      v_month text := to_char(v_local, 'YYYY-MM');
    begin
      insert into public.audit_log (channel, chat_id, user_id, workspace_id, tool, action_type,
        changes_state, arg_names, extra_args, args_sha256, decision, outcome)
        values ('admin', 'usage', ${ME}, coalesce(${WS}, '00000000-0000-0000-0000-000000000001'::uuid),
        'admin.usage.summary', 'admin.read', false, '{}', 0, encode(sha256(''::bytea), 'hex'),
        'auto', case when v_ws is null then 'refused' else 'ok' end);
      if v_ws is null then return; end if;
      return query
        select u.id, u.role, c.email, b.monthly_limit_usd, u.max_parallel_tasks,
          u.topup_amount_usd,
          coalesce((select sum(t.amount_usd) from public.budget_topups t
            where t.user_id = u.id and t.status = 'approved' and t.month = v_month), 0),
          coalesce((select sum(l.cost_usd) from public.usage_ledger l
            where l.user_id = u.id and l.created_at >= v_start and l.created_at < v_end), 0),
          (select count(*) from public.usage_ledger l
            where l.user_id = u.id and l.created_at >= v_start and l.created_at < v_end),
          v_month
        from public.users u
        left join public.credentials c on c.user_id = u.id
        left join public.budgets b on b.user_id = u.id and b.workspace_id = u.workspace_id
        where u.workspace_id = v_ws order by u.created_at, u.id;
    end $$`.execute(db);
  await sql`revoke execute on function public.admin_usage_summary(timestamptz, text)
    from public`.execute(db);
}
