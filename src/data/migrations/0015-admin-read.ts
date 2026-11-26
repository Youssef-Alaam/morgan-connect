import { type Kysely, sql } from 'kysely';

/**
 * The admin's read path (M2-2, D59): the only way anyone sees another person's rows. Two named
 * functions, one per readable kind, run as their owner (SECURITY DEFINER, like migration 0012).
 * Each first calls a private gate that writes the `admin.read` audit row, then returns the rows;
 * both happen in the caller's transaction, so if the audit insert fails nothing is returned. The
 * gate admits only an admin acting as themselves (the person set on the transaction by `withOwner`)
 * and only inside their own workspace; any other caller gets an audited refusal and no rows. The
 * audit row names the person actually set on the transaction, not the id the caller passed. The
 * gate is not granted to the app role, so rows cannot be had without the audit row.
 */
const SAFE = sql.raw('security definer set search_path = pg_catalog, public, pg_temp');
const DEFAULT_WORKSPACE = '00000000-0000-0000-0000-000000000001';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table audit_log add column subject_user_id uuid, add column reason text`.execute(
    db,
  );
  // Set when the member is told, on joining, that the admin can read their chats (M2-5b).
  await sql`alter table users add column told_admin_can_read_at timestamptz`.execute(db);
  await sql`create function public.admin_read_gate(p_kind text, p_admin uuid, p_member uuid,
    p_reason text) returns uuid language plpgsql ${SAFE} as $$
    declare
      v_role text;
      v_ws uuid;
      v_ok boolean;
      v_me uuid := nullif(current_setting('app.user_id', true), '')::uuid;
      v_my_ws uuid := nullif(current_setting('app.workspace_id', true), '')::uuid;
    begin
      select u.role, u.workspace_id into v_role, v_ws from public.users u where u.id = p_admin;
      v_ok := v_role = 'admin'
        and p_admin = v_me
        and v_ws = v_my_ws
        and btrim(coalesce(p_reason, '')) <> ''
        and exists (select 1 from public.users m where m.id = p_member and m.workspace_id = v_ws);
      insert into public.audit_log (channel, chat_id, user_id, workspace_id, tool, action_type,
        changes_state, arg_names, extra_args, args_sha256, decision, outcome, subject_user_id, reason)
      values ('admin', 'read', v_me,
        coalesce(v_my_ws, ${sql.lit(DEFAULT_WORKSPACE)}::uuid), 'admin.read.' || p_kind, 'admin.read',
        false, '{}', 0, encode(sha256(convert_to(coalesce(p_reason, ''), 'UTF8')), 'hex'), 'auto',
        case when v_ok then 'ok' else 'refused' end, p_member, p_reason);
      return case when v_ok then v_ws end;
    end $$`.execute(db);
  await createReaders(db);
}

async function createReaders(db: Kysely<unknown>): Promise<void> {
  await sql`create function public.admin_read_chat(p_admin uuid, p_member uuid, p_reason text,
    p_limit integer) returns jsonb language plpgsql ${SAFE} as $$
    declare
      v_ws uuid := public.admin_read_gate('chat', p_admin, p_member, p_reason);
      v_rows jsonb;
    begin
      if v_ws is null then return null; end if;
      with m as (select id::text as id, channel, chat_id, role, text, data, created_at
        from public.chat_messages where user_id = p_member and workspace_id = v_ws
        order by id desc limit least(greatest(coalesce(p_limit, 500), 1), 500))
      select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at, m.id), '[]') into v_rows from m;
      return v_rows;
    end $$`.execute(db);
  await sql`create function public.admin_read_usage(p_admin uuid, p_member uuid, p_reason text,
    p_limit integer) returns jsonb language plpgsql ${SAFE} as $$
    declare
      v_ws uuid := public.admin_read_gate('usage', p_admin, p_member, p_reason);
      v_rows jsonb;
    begin
      if v_ws is null then return null; end if;
      with m as (select id::text as id, channel, chat_id, model, status,
          input_tokens::text as input_tokens, output_tokens::text as output_tokens,
          cache_read_tokens::text as cache_read_tokens, cache_write_tokens::text as cache_write_tokens,
          cost_usd::text as cost_usd, created_at
        from public.usage_ledger where user_id = p_member and workspace_id = v_ws
        order by id desc limit least(greatest(coalesce(p_limit, 500), 1), 500))
      select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at, m.id), '[]') into v_rows from m;
      return v_rows;
    end $$`.execute(db);
  // Not executable by everyone; the app role gets the two public ones by name (ensureAppRole).
  await sql`revoke execute on function public.admin_read_gate(text, uuid, uuid, text),
    public.admin_read_chat(uuid, uuid, text, integer),
    public.admin_read_usage(uuid, uuid, text, integer) from public`.execute(db);
}
