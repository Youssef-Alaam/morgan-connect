import { type Kysely, sql } from 'kysely';

/**
 * The few reads and writes that happen before a person is known (M2-1a). Each is one named
 * function with a fixed job, run as its owner (SECURITY DEFINER), so row-level security on the
 * tables can stay strict and the app role never gets a general way around it. Nothing here takes
 * a free query: the unknown-sender lookup answers only for the one chat it is given.
 */
const SAFE = sql.raw('security definer set search_path = pg_catalog, public, pg_temp');

export async function up(db: Kysely<unknown>): Promise<void> {
  // Unknown-sender gate: the owner of exactly this chat, or no row.
  await sql`create function public.system_chat_owner(p_channel text, p_chat_id text)
    returns table (user_id uuid, workspace_id uuid) language sql stable ${SAFE} as $$
      select u.id, u.workspace_id from public.devices d join public.users u on u.id = d.user_id
      where d.channel = p_channel and d.chat_id = p_chat_id $$`.execute(db);
  // Worker: a queued job carries only the turn id.
  await sql`create function public.system_turn_owner(p_turn_id uuid)
    returns table (user_id uuid, workspace_id uuid) language sql stable ${SAFE} as $$
      select t.user_id, t.workspace_id from public.turns t where t.id = p_turn_id $$`.execute(db);
  // Startup sweeps: turns stored but never queued, and questions nobody waits on any more.
  await sql`create function public.system_queued_turn_ids() returns setof uuid
    language sql stable ${SAFE} as $$
      select t.id from public.turns t where t.status = 'queued' $$`.execute(db);
  await sql`create function public.system_expire_open_approvals() returns integer
    language sql ${SAFE} as $$
      with closed as (update public.approvals set status = 'expired'
        where status in ('pending', 'approved') returning 1)
      select count(*)::integer from closed $$`.execute(db);
  // Setup: has anyone claimed the install, and the one-step claim that creates the admin.
  await sql`create function public.system_install_claimed() returns boolean
    language sql stable ${SAFE} as $$ select exists (select 1 from public.users) $$`.execute(db);
  await sql`create function public.system_claim_install(p_code_hash text, p_channel text,
    p_chat_id text) returns boolean language plpgsql ${SAFE} as $$
    declare
      v_user uuid;
    begin
      -- Share-row-exclusive: two claims cannot both see "no admin yet".
      lock table public.users in share row exclusive mode;
      if exists (select 1 from public.users) then return false; end if;
      update public.setup_codes set claimed_at = now()
        where code_hash = p_code_hash and claimed_at is null;
      if not found then return false; end if;
      insert into public.users (role) values ('admin') returning id into v_user;
      insert into public.devices (user_id, channel, chat_id) values (v_user, p_channel, p_chat_id);
      return true;
    end $$`.execute(db);
  await sql`revoke execute on all functions in schema public from public`.execute(db);
  // Functions made later by this role are not executable by everyone either.
  await sql`alter default privileges revoke execute on functions from public`.execute(db);
}
