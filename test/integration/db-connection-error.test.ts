import { sql } from 'kysely';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createDb, type Db } from '../../src/data/index.js';
import { startPostgres, type TestPostgres } from '../helpers/postgres.js';

let postgres: TestPostgres;
let db: Db;
const heard = vi.fn<(error: Error) => void>();

beforeAll(async () => {
  postgres = await startPostgres();
  db = createDb(postgres.url, heard);
}, 180_000);
afterAll(async () => {
  await db.destroy();
  await postgres.stop();
});

it('hands a connection the server kills to the listener instead of crashing', async () => {
  await sql`select 1`.execute(db);
  const killer = createDb(postgres.url);
  try {
    await sql`select pg_terminate_backend(pid) from pg_stat_activity
      where datname = current_database() and pid <> pg_backend_pid()`.execute(killer);
  } finally {
    await killer.destroy();
  }
  await vi.waitFor(() => {
    expect(heard).toHaveBeenCalled();
  });
  expect(heard.mock.calls[0]?.[0]).toMatchObject({ code: '57P01' });
  await expect(sql`select 1`.execute(db)).resolves.toBeDefined();
});
