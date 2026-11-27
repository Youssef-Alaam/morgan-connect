import { type Kysely, sql } from 'kysely';

/**
 * Budgets (M2-10a): the monthly limit on the admin's API keys for one person in one workspace. A
 * person with no row gets the install default (a setting, not a row). The limit is a decimal,
 * never a float, like the usage ledger's cost.
 *
 * A person may read their own row but never write it: only `admin_set_budget` writes, as the
 * admin on the transaction, and it records an audit row either way (like 0015 and 0017).
 */
const SAFE = sql.raw('security definer set search_path = pg_catalog, public, pg_temp');
const ME = sql`nullif(current_setting('app.user_id', true), '')::uuid`;
const WS = sql`nullif(current_setting('app.workspace_id', true), '')::uuid`;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create table budgets (user_id uuid not null, workspace_id uuid not null,
    monthly_limit_usd numeric(14, 8) not null check (monthly_limit_usd >= 0),
    updated_at timestamptz not null default now(),
    primary key (user_id, workspace_id),
    foreign key (user_id, workspace_id) references users (id, workspace_id))`.execute(db);
  await sql`alter table budgets enable row level security`.execute(db);
  await sql`alter table budgets force row level security`.execute(db);
  await sql`create policy own_rows on budgets for select
    using (user_id = ${ME} and workspace_id = ${WS})`.execute(db);
  // Trust boundary: acts only as the person set on the transaction, only if they are an admin, and
  // only on a member of the same workspace. False (and a refused audit row) otherwise.
  await sql`create function public.admin_set_budget(p_member uuid, p_limit numeric)
    returns boolean language plpgsql ${SAFE} as $$
    declare v_ws uuid; v_ok boolean;
    begin
      select u.workspace_id into v_ws from public.users u
        where u.id = ${ME} and u.role = 'admin' and u.workspace_id = ${WS};
      v_ok := v_ws is not null and p_limit is not null and p_limit >= 0
        and exists (select 1 from public.users m where m.id = p_member and m.workspace_id = v_ws);
      if v_ok then
        insert into public.budgets (user_id, workspace_id, monthly_limit_usd)
          values (p_member, v_ws, p_limit)
          on conflict (user_id, workspace_id)
          do update set monthly_limit_usd = excluded.monthly_limit_usd, updated_at = now();
      end if;
      insert into public.audit_log (channel, chat_id, user_id, workspace_id, tool, action_type,
        changes_state, arg_names, extra_args, args_sha256, decision, outcome, subject_user_id)
      values ('admin', 'budget', ${ME}, coalesce(v_ws, ${WS}), 'admin.budget.set', 'admin.budget',
        true, '{}', 0, encode(sha256(convert_to(coalesce(p_limit::text, ''), 'UTF8')), 'hex'),
        'auto', case when v_ok then 'ok' else 'refused' end, p_member);
      return v_ok;
    end $$`.execute(db);
}
