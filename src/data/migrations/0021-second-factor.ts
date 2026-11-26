import { type Kysely, sql } from 'kysely';

/**
 * Second factor (M2-6): an authenticator secret (stored encrypted, never plain) and backup codes
 * (stored as keyed hashes). Both are keyed to the person and sit under the same RLS as every
 * user-data table; they are read only after the person is known, so no system function is needed.
 */
const ME = sql`nullif(current_setting('app.user_id', true), '')::uuid`;
const WS = sql`nullif(current_setting('app.workspace_id', true), '')::uuid`;

async function lock(db: Kysely<unknown>, table: string): Promise<void> {
  await sql`alter table ${sql.table(table)} enable row level security`.execute(db);
  await sql`alter table ${sql.table(table)} force row level security`.execute(db);
  await sql`create policy own_rows on ${sql.table(table)}
    using (user_id = ${ME} and workspace_id = ${WS})
    with check (user_id = ${ME} and workspace_id = ${WS})`.execute(db);
}

export async function up(db: Kysely<unknown>): Promise<void> {
  // One authenticator per person. `confirmed_at` stays null until they prove the app works;
  // `last_step` is the newest 30-second step already used, so a code cannot be used twice.
  await sql`create table totp_factors (user_id uuid primary key, workspace_id uuid not null,
    secret_sealed text not null, confirmed_at timestamptz, last_step bigint not null default 0,
    created_at timestamptz not null default now(),
    foreign key (user_id, workspace_id) references users (id, workspace_id))`.execute(db);
  await sql`create table backup_codes (id uuid primary key default gen_random_uuid(),
    user_id uuid not null, workspace_id uuid not null, code_hash text not null,
    created_at timestamptz not null default now(), used_at timestamptz,
    unique (user_id, code_hash),
    foreign key (user_id, workspace_id) references users (id, workspace_id))`.execute(db);
  for (const table of ['totp_factors', 'backup_codes']) await lock(db, table);
}
