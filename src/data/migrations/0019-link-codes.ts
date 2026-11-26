import { type Kysely, sql } from 'kysely';

/**
 * Link codes (M2-8): a signed-in person asks for a short one-time code and sends `/link <code>` from
 * a chat, which then becomes one of their devices. Only the code's hash is stored. Spending a code
 * happens before the chat's owner is known, so it is a named function (like 0012).
 */
const SAFE = sql.raw('security definer set search_path = pg_catalog, public, pg_temp');
const ME = sql`nullif(current_setting('app.user_id', true), '')::uuid`;
const WS = sql`nullif(current_setting('app.workspace_id', true), '')::uuid`;

async function createTable(db: Kysely<unknown>): Promise<void> {
  await sql`create table link_codes (id uuid primary key default gen_random_uuid(),
    user_id uuid not null, workspace_id uuid not null,
    code_hash text not null unique,
    created_at timestamptz not null default now(), expires_at timestamptz not null, used_at timestamptz,
    foreign key (user_id, workspace_id) references users (id, workspace_id))`.execute(db);
  await sql`alter table link_codes enable row level security`.execute(db);
  await sql`alter table link_codes force row level security`.execute(db);
  await sql`create policy own_rows on link_codes
    using (user_id = ${ME} and workspace_id = ${WS})
    with check (user_id = ${ME} and workspace_id = ${WS})`.execute(db);
}

async function createFunctions(db: Kysely<unknown>): Promise<void> {
  // One step: spend the code and link the chat to the person who asked for it, or neither. A chat
  // that is already linked (to anyone) is left as it is and the code is not spent. The audit row
  // is written in the same step, so a link never exists without it.
  await sql`create function public.system_redeem_link_code(p_code_hash text, p_channel text,
    p_chat_id text) returns table (user_id uuid, workspace_id uuid) language plpgsql ${SAFE} as $$
    #variable_conflict use_column
    declare v_user uuid; v_ws uuid;
    begin
      if p_channel = 'web' then return; end if;
      if exists (select 1 from public.devices d where d.channel = p_channel and d.chat_id = p_chat_id)
        then return; end if;
      update public.link_codes set used_at = now()
        where code_hash = p_code_hash and used_at is null and expires_at > now()
        returning link_codes.user_id, link_codes.workspace_id into v_user, v_ws;
      if v_user is null then return; end if;
      insert into public.devices (user_id, channel, chat_id) values (v_user, p_channel, p_chat_id);
      insert into public.audit_log (channel, chat_id, user_id, workspace_id, tool, action_type,
        changes_state, arg_names, extra_args, args_sha256, decision, outcome, subject_user_id)
        values (p_channel, p_chat_id, v_user, v_ws, 'device.link', 'device.link', true, '{}', 0,
        encode(sha256(''::bytea), 'hex'), 'auto', 'ok', v_user);
      return query select v_user, v_ws;
    end $$`.execute(db);
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await createTable(db);
  await createFunctions(db);
  await sql`revoke execute on function public.system_redeem_link_code(text, text, text)
    from public`.execute(db);
}
