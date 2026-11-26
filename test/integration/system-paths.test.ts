import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  claimSetupCode,
  createDb,
  ensureAppRole,
  isDeviceLinked,
  listQueuedTurnIds,
  migrateToLatest,
  ownerOf,
  replaceSetupCode,
  withOwner,
  type Database,
  type Db,
} from '../../src/data/index.js';
import { startPostgres, type TestPostgres } from '../helpers/postgres.js';

let postgres: TestPostgres;
let superuser: Db;
let owner: Db;
let app: Db;
let appUrl: string;

/** The container's URL with another role and database. */
function urlAs(user: string, password: string, database = 'owned'): string {
  const url = new URL(postgres.url);
  url.username = user;
  url.password = password;
  url.pathname = `/${database}`;
  return url.toString();
}

beforeAll(async () => {
  postgres = await startPostgres();
  superuser = createDb(postgres.url);
  // A normal owner, as a managed Postgres would give: not a superuser, but BYPASSRLS.
  await sql`create role morgan_owner login createrole bypassrls password 'owner-pass'`.execute(
    superuser,
  );
  await sql`create role plain_owner login createrole password 'plain-pass'`.execute(superuser);
  await sql`create database owned owner morgan_owner`.execute(superuser);
  owner = createDb(urlAs('morgan_owner', 'owner-pass'));
  await migrateToLatest(owner);
  appUrl = urlAs('morgan_app', 'app-pass-sys');
  await ensureAppRole(owner, appUrl);
  app = createDb(appUrl);
}, 180_000);

afterAll(async () => {
  await app.destroy();
  await owner.destroy();
  await superuser.destroy();
  await postgres.stop();
});

it('runs every system path as the app role under a non-superuser owner', async () => {
  expect(await replaceSetupCode(app, 'h1')).toBe(true);
  expect(await claimSetupCode(app, 'h1', 'fake', 'c1')).toBe(true);
  expect(await claimSetupCode(app, 'h1', 'fake', 'c2')).toBe(false);
  expect(await replaceSetupCode(app, 'h2')).toBe(false);
  expect((await ownerOf(app, { channel: 'fake', chatId: 'c1' }))?.userId).toMatch(
    /^[0-9a-f-]{36}$/,
  );
  expect(await isDeviceLinked(app, 'fake', 'nobody')).toBe(false);
  expect(await listQueuedTurnIds(app)).toEqual([]);
});

it('refuses an owner role that would be held back by row-level security', async () => {
  await sql`grant create on database owned to plain_owner`.execute(superuser);
  const plain = createDb(urlAs('plain_owner', 'plain-pass'));
  try {
    await expect(ensureAppRole(plain, urlAs('other_app', 'x'))).rejects.toThrow('BYPASSRLS');
  } finally {
    await plain.destroy();
  }
});

it('lets the app role run only the named system paths', async () => {
  await sql`create function public.later_fn() returns int language sql as 'select 1'`.execute(
    owner,
  );
  await expect(sql`select public.later_fn()`.execute(app)).rejects.toThrow('permission denied');
});

it('leaves no person set on the pooled connection after a rolled back withOwner', async () => {
  const single: Db = new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: appUrl, max: 1 }) }),
  });
  try {
    const who = {
      userId: '00000000-0000-0000-0000-0000000000b1',
      workspaceId: '00000000-0000-0000-0000-000000000001',
    };
    await expect(withOwner(single, who, () => Promise.reject(new Error('boom')))).rejects.toThrow(
      'boom',
    );
    const { rows } = await sql<{ user: string | null; ws: string | null }>`
      select current_setting('app.user_id', true) as user,
        current_setting('app.workspace_id', true) as ws`.execute(single);
    expect([rows[0]?.user ?? '', rows[0]?.ws ?? '']).toEqual(['', '']);
  } finally {
    await single.destroy();
  }
});
