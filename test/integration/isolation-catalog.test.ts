import { sql } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDb, migrateToLatest, type Db } from '../../src/data/index.js';
import { RLS_EXEMPT_TABLES } from '../../src/data/rls.js';
import { COVERED } from '../helpers/isolation.js';
import { startPostgres, type TestPostgres } from '../helpers/postgres.js';

// The authority behind CI step 14: what the database holds, not what a migration's text says. A
// table renamed, made in another schema, or named by a constant still shows up in the catalog.
let postgres: TestPostgres;
let owner: Db;

beforeAll(async () => {
  postgres = await startPostgres();
  owner = createDb(postgres.url);
  await migrateToLatest(owner);
}, 180_000);
afterAll(async () => {
  await owner.destroy();
  await postgres.stop();
});

interface Found {
  schema: string;
  name: string;
  userId: boolean;
  rls: boolean;
}

async function tables(): Promise<Found[]> {
  const { rows } = await sql<Found>`
    select n.nspname as schema, c.relname as name, c.relrowsecurity as rls,
      exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'user_id'
        and a.attnum > 0 and not a.attisdropped) as "userId"
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p')
      and n.nspname not in ('pg_catalog', 'information_schema', 'pgboss')
      and n.nspname not like 'pg_toast%'`.execute(owner);
  return rows;
}

it('has no user_id on an exempt table, in any schema', async () => {
  const hidden = (await tables()).filter((t) => t.userId && RLS_EXEMPT_TABLES.includes(t.name));
  expect(hidden).toEqual([]);
});

it('has an isolation test for exactly the tables that hold a person data', async () => {
  const held = (await tables())
    .filter((t) => (t.userId || t.rls) && !RLS_EXEMPT_TABLES.includes(t.name))
    .map((t) => (t.schema === 'public' ? t.name : `${t.schema}.${t.name}`))
    .sort();
  expect(held).toEqual([...COVERED].sort());
});
