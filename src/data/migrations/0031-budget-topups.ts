import { type Kysely, sql } from 'kysely';

/**
 * Top-ups (M2-10b): a member asks for more this month, the admin approves or refuses. One row per
 * request, in the member's name; an approved row raises that month's limit and the next month
 * starts again from the base limit. At most one request per person is open at a time (the partial
 * unique index). The request's question to the admin is an ordinary `approvals` row (M1-6), so an
 * approval is single use and bound to the exact amount; `approval_id` links the two.
 *
 * A member may read their own rows and write none: only the named functions write, each acting as
 * the person on the transaction and writing its audit row in the same step (like 0015 and 0026).
 */
const SAFE = sql.raw('security definer set search_path = pg_catalog, public, pg_temp');
const ME = sql`nullif(current_setting('app.user_id', true), '')::uuid`;
const WS = sql`nullif(current_setting('app.workspace_id', true), '')::uuid`;

const AUDIT = sql`insert into public.audit_log (channel, chat_id, user_id, workspace_id, tool,
  action_type, changes_state, arg_names, extra_args, args_sha256, decision, outcome, subject_user_id)`;

async function table(db: Kysely<unknown>): Promise<void> {
  await sql`create table budget_topups (id uuid primary key default gen_random_uuid(),
    user_id uuid not null, workspace_id uuid not null,
    amount_usd numeric(14, 8) not null check (amount_usd > 0),
    month text not null check (month ~ '^[0-9]{4}-[0-9]{2}$'),
    status text not null default 'open'
      check (status in ('open', 'approved', 'refused', 'expired', 'cancelled')),
    approval_id uuid,
    channel text not null, chat_id text not null,
    created_at timestamptz not null default now(), expires_at timestamptz not null,
    decided_at timestamptz,
    foreign key (user_id, workspace_id) references users (id, workspace_id))`.execute(db);
  await sql`create unique index budget_topups_one_open on budget_topups (user_id)
    where status = 'open'`.execute(db);
  await sql`create unique index budget_topups_approval on budget_topups (approval_id)
    where approval_id is not null`.execute(db);
  await sql`alter table budget_topups enable row level security`.execute(db);
  await sql`alter table budget_topups force row level security`.execute(db);
  await sql`create policy own_rows on budget_topups for select
    using (user_id = ${ME} and workspace_id = ${WS})`.execute(db);
}

/** The member asks. Returns who to ask; `open` when a request is already waiting. */
async function requestFunction(db: Kysely<unknown>): Promise<void> {
  await sql`create function public.request_topup(p_amount numeric, p_month text, p_channel text,
    p_chat text, p_admin_channel text, p_now timestamptz, p_expires timestamptz, p_hash text)
    returns table (outcome text, topup_id uuid, approval_id uuid, admin_chat text, who text)
    language plpgsql ${SAFE} as $$
    #variable_conflict use_column
    declare v_ws uuid; v_admin uuid; v_chat text; v_id uuid; v_ap uuid;
    begin
      select u.workspace_id into v_ws from public.users u
        where u.id = ${ME} and u.role = 'member' and u.workspace_id = ${WS};
      if v_ws is null or p_amount is null or p_amount <= 0 then
        return query select 'unavailable', null::uuid, null::uuid, null::text, null::text;
        return;
      end if;
      update public.approvals set status = 'expired' where status = 'pending'
        and id in (select t.approval_id from public.budget_topups t
          where t.user_id = ${ME} and t.status = 'open' and t.expires_at <= p_now);
      update public.budget_topups set status = 'expired'
        where user_id = ${ME} and status = 'open' and expires_at <= p_now;
      select d.user_id, d.chat_id into v_admin, v_chat from public.devices d
        join public.users a on a.id = d.user_id
        where a.workspace_id = v_ws and a.role = 'admin' and d.channel = p_admin_channel
        order by d.created_at limit 1;
      if v_admin is null then
        return query select 'no_admin', null::uuid, null::uuid, null::text, null::text;
        return;
      end if;
      begin
        insert into public.budget_topups (user_id, workspace_id, amount_usd, month, channel,
          chat_id, expires_at) values (${ME}, v_ws, p_amount, p_month, p_channel, p_chat, p_expires)
          returning id into v_id;
      exception when unique_violation then
        return query select 'open', null::uuid, null::uuid, null::text, null::text;
        return;
      end;
      insert into public.approvals (user_id, workspace_id, channel, chat_id, tool, args_sha256,
        expires_at) values (v_admin, v_ws, p_admin_channel, v_chat, 'budget.topup', p_hash, p_expires)
        returning id into v_ap;
      update public.budget_topups set approval_id = v_ap where id = v_id;
      ${AUDIT} values (p_channel, p_chat, ${ME}, v_ws, 'budget.topup.request', 'budget.topup', true,
        '{}', 0, p_hash, 'auto', 'ok', ${ME});
      return query select 'created', v_id, v_ap, v_chat,
        coalesce((select c.email from public.credentials c where c.user_id = ${ME} limit 1),
          'member ' || left(${ME}::text, 8));
    end $$`.execute(db);
}

/** The member's request that could not be shown to the admin: closed so they can ask again. */
async function cancelFunction(db: Kysely<unknown>): Promise<void> {
  await sql`create function public.cancel_topup(p_id uuid) returns boolean
    language plpgsql ${SAFE} as $$
    declare v_ap uuid;
    begin
      update public.budget_topups set status = 'cancelled', decided_at = now()
        where id = p_id and user_id = ${ME} and workspace_id = ${WS} and status = 'open'
        returning approval_id into v_ap;
      if not found then return false; end if;
      update public.approvals set status = 'cancelled' where id = v_ap and status = 'pending';
      return true;
    end $$`.execute(db);
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await table(db);
  await requestFunction(db);
  await cancelFunction(db);
}
