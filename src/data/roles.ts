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
    // CREATE on the database lets the queue (pg-boss) make its own schema; public stays closed.
    await sql`grant connect, create on database ${sql.id(state.db)} to ${who}`.execute(trx);
    await sql`grant usage on schema public to ${who}`.execute(trx);
    await sql`grant select, insert, update, delete on all tables in schema public to ${who}`.execute(
      trx,
    );
    await sql`grant usage, select on all sequences in schema public to ${who}`.execute(trx);
    await sql`revoke update, delete, truncate on audit_log from ${who}`.execute(trx);
    if (state.boss) await grantQueueSchema(trx, who);
  });
}

/** A queue schema made earlier by the owner role: the app role runs the queue in it. */
async function grantQueueSchema(
  trx: QueryExecutorProvider,
  who: ReturnType<typeof sql.id>,
): Promise<void> {
  await sql`grant usage, create on schema pgboss to ${who}`.execute(trx);
  await sql`grant all on all tables in schema pgboss to ${who}`.execute(trx);
  await sql`grant all on all sequences in schema pgboss to ${who}`.execute(trx);
  await sql`grant execute on all functions in schema pgboss to ${who}`.execute(trx);
}
