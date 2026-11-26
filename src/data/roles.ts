import { type QueryExecutorProvider, sql } from 'kysely';
import type { Db } from './db.js';

export interface AppCredentials {
  user: string;
  password: string;
}

/** The role name and password inside a connection string. Throws without echoing the string. */
export function appCredentials(databaseUrl: string): AppCredentials {
  const url = new URL(databaseUrl);
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  if (user === '' || password === '') {
    throw new Error('DATABASE_URL must name the app role and its password');
  }
  return { user, password };
}

/**
 * Create or refresh the app role and grant it what it needs; run as the owner role after every
 * migration, so tables added later are covered too. The app role is not a superuser and owns
 * nothing, so it cannot disable the audit_log triggers; on audit_log it may only INSERT and SELECT.
 * The password comes from DATABASE_URL and is never logged (docs/adr/0008-audit-log-guards.md).
 */
export async function ensureAppRole(owner: Db, databaseUrl: string): Promise<void> {
  const { user, password } = appCredentials(databaseUrl);
  const who = sql.id(user);
  await owner.transaction().execute(async (trx) => {
    // Two boots at once must not fight over one role.
    await sql`select pg_advisory_xact_lock(hashtext('morgan.ensure_app_role'))`.execute(trx);
    const { rows } = await sql<{ me: string; db: string; found: boolean; boss: boolean }>`
      select current_user as me, current_database() as db,
        exists (select 1 from pg_roles where rolname = ${user}) as found,
        exists (select 1 from pg_namespace where nspname = 'pgboss') as boss`.execute(trx);
    const state = rows[0];
    if (state === undefined) throw new Error('Postgres returned no role state');
    if (state.me === user) {
      throw new Error('MIGRATION_DATABASE_URL and DATABASE_URL must use different roles');
    }
    const verb = state.found ? 'alter role %I' : 'create role %I';
    const statement = await sql<{ text: string }>`
      select format(${verb + ' with login nosuperuser nocreatedb nocreaterole nobypassrls password %L'}::text,
        ${user}::text, ${password}::text) as text`.execute(trx);
    await sql.raw(statement.rows[0]?.text ?? '').execute(trx);
    // No CREATE on the database: the app cannot make a schema that shadows public.
    await sql`grant connect on database ${sql.id(state.db)} to ${who}`.execute(trx);
    await sql`grant usage on schema public to ${who}`.execute(trx);
    await sql`grant select, insert, update, delete on all tables in schema public to ${who}`.execute(
      trx,
    );
    await sql`grant usage, select on all sequences in schema public to ${who}`.execute(trx);
    // Every name is schema-qualified, so nothing the app makes can stand in for these tables.
    await sql`revoke update, delete, truncate on public.audit_log from ${who}`.execute(trx);
    // The migration books are the owner's alone to write.
    await sql`revoke insert, update, delete, truncate on public.schema_info, public.kysely_migration,
      public.kysely_migration_lock from ${who}`.execute(trx);
    if (state.boss) await grantQueueSchema(trx, who);
  });
}

/** The queue schema the owner role installed (installQueueSchema): the app role runs the queue in it. */
async function grantQueueSchema(
  trx: QueryExecutorProvider,
  who: ReturnType<typeof sql.id>,
): Promise<void> {
  await sql`grant usage, create on schema pgboss to ${who}`.execute(trx);
  await sql`grant all on all tables in schema pgboss to ${who}`.execute(trx);
  await sql`grant all on all sequences in schema pgboss to ${who}`.execute(trx);
  await sql`grant execute on all functions in schema pgboss to ${who}`.execute(trx);
}
