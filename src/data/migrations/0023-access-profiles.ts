import { type Kysely, sql } from 'kysely';

/**
 * Access profiles (M2-9a). `access_profiles` holds the three presets: install-wide settings with no
 * person in them, so it is on the exempt list and the app role may only read it. A person's own
 * choice lives in `profile_assignments` (user data, RLS): one row for the person, optionally one
 * per device. Only the admin's named function writes one, so a member cannot raise their own
 * profile; it writes the audit row in the same step and returns the state before the change.
 */
const SAFE = sql.raw('security definer set search_path = pg_catalog, public, pg_temp');
const ME = sql`nullif(current_setting('app.user_id', true), '')::uuid`;
const WS = sql`nullif(current_setting('app.workspace_id', true), '')::uuid`;

// The values are the table the owner signs (PR description, M2-9a); a test compares them.
const ALL_ASK = {
  read: 'auto',
  create: 'ask',
  overwrite: 'ask',
  delete: 'ask',
  send: 'ask',
  execute: 'ask',
};
const PRESETS = {
  restricted: {
    ...ALL_ASK,
    create: 'off',
    overwrite: 'off',
    delete: 'off',
    send: 'off',
    execute: 'off',
  },
  standard: ALL_ASK,
  trusted: { ...ALL_ASK, create: 'auto', overwrite: 'auto' },
};

async function presets(db: Kysely<unknown>): Promise<void> {
  await sql`create table access_profiles (preset text primary key
    check (preset in ('restricted', 'standard', 'trusted')), modes jsonb not null,
    shell_gate text not null default 'risky_only'
    check (shell_gate in ('strict', 'risky_only', 'off')))`.execute(db);
  for (const [preset, modes] of Object.entries(PRESETS)) {
    await sql`insert into access_profiles (preset, modes)
      values (${preset}, ${JSON.stringify(modes)}::jsonb)`.execute(db);
  }
}

async function assignments(db: Kysely<unknown>): Promise<void> {
  await sql`alter table devices add constraint devices_id_user_unique unique (id, user_id)`.execute(
    db,
  );
  await sql`create table profile_assignments (id uuid primary key default gen_random_uuid(),
    user_id uuid not null, workspace_id uuid not null, device_id uuid,
    preset text not null references access_profiles (preset),
    created_at timestamptz not null default now(),
    foreign key (user_id, workspace_id) references users (id, workspace_id),
    foreign key (device_id, user_id) references devices (id, user_id) on delete cascade)`.execute(
    db,
  );
  await sql`create unique index profile_assignments_person on profile_assignments (user_id)
    where device_id is null`.execute(db);
  await sql`create unique index profile_assignments_device on profile_assignments (device_id)
    where device_id is not null`.execute(db);
  await sql`alter table profile_assignments enable row level security`.execute(db);
  await sql`alter table profile_assignments force row level security`.execute(db);
  // Reads only: with no policy for writes, a person's own insert is refused too.
  await sql`create policy own_rows on profile_assignments for select
    using (user_id = ${ME} and workspace_id = ${WS})`.execute(db);
}

/** Admin only, same workspace. Returns nothing when refused, else the state before the change. */
async function assignFunction(db: Kysely<unknown>): Promise<void> {
  await sql`create function public.admin_assign_profile(p_user uuid, p_device uuid, p_preset text)
    returns table (role text, person_preset text, device_preset text)
    language plpgsql ${SAFE} as $$
    declare
      v_me uuid := ${ME};
      v_ws uuid := ${WS};
      v_role text; v_person text; v_device text; v_ok boolean;
    begin
      if v_me is null or v_ws is null then return; end if;
      select u.role into v_role from public.users u where u.id = p_user and u.workspace_id = v_ws;
      v_ok := v_role is not null and exists (select 1 from public.users a
        where a.id = v_me and a.role = 'admin' and a.workspace_id = v_ws)
        and (p_device is null or exists (select 1 from public.devices d
          where d.id = p_device and d.user_id = p_user));
      if v_ok then
        select a.preset into v_person from public.profile_assignments a
          where a.user_id = p_user and a.device_id is null;
        select a.preset into v_device from public.profile_assignments a where a.device_id = p_device;
        if p_device is null then
          insert into public.profile_assignments (user_id, workspace_id, preset)
            values (p_user, v_ws, p_preset)
            on conflict (user_id) where device_id is null do update set preset = excluded.preset;
        else
          insert into public.profile_assignments (user_id, workspace_id, device_id, preset)
            values (p_user, v_ws, p_device, p_preset)
            on conflict (device_id) where device_id is not null
            do update set preset = excluded.preset;
        end if;
      end if;
      insert into public.audit_log (channel, chat_id, user_id, workspace_id, tool, action_type,
        changes_state, arg_names, extra_args, args_sha256, decision, outcome, subject_user_id, reason)
        values ('web', 'profile', v_me, v_ws, 'admin.profile.assign', 'admin.profile.assign', true,
        '{}', 0, encode(sha256(''::bytea), 'hex'), 'auto',
        case when v_ok then 'ok' else 'refused' end,
        p_user, p_preset || ' for ' || coalesce(p_device::text, 'person'));
      if v_ok then return query select v_role, v_person, v_device; end if;
    end $$`.execute(db);
  await sql`revoke execute on function public.admin_assign_profile(uuid, uuid, text) from public`.execute(
    db,
  );
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await presets(db);
  await assignments(db);
  await assignFunction(db);
}
