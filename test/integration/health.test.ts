import { sql } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { start } from '../../src/boot.js';
import { createDb, migrateToLatest } from '../../src/data/index.js';
import { roleUrls, startPostgres, type TestPostgres } from '../helpers/postgres.js';

let postgres: TestPostgres;

beforeAll(async () => {
  postgres = await startPostgres();
});

afterAll(async () => {
  await postgres.stop();
});

it('migrates an empty database and answers /health with the server version', async () => {
  const db = createDb(postgres.url);
  const probe = sql<{
    name: string | null;
  }>`select to_regclass('public.schema_info')::text as name`;
  expect((await probe.execute(db)).rows[0]?.name).toBeNull();

  const running = await start({ ...roleUrls(postgres.url), PORT: '0', LOG_LEVEL: 'silent' });
  try {
    expect((await probe.execute(db)).rows[0]?.name).toBe('schema_info');
    expect(await migrateToLatest(db)).toEqual([]);
    const response = await fetch(`http://127.0.0.1:${String(running.port)}/health`);
    const body: unknown = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: 'ok' });
    expect(JSON.stringify(body)).toMatch(/"db":"17\./);
  } finally {
    await running.stop();
    await db.destroy();
  }
});

it('refuses to start as a superuser, since row-level security would be off', async () => {
  await expect(
    start({ DATABASE_URL: postgres.url, PORT: '0', LOG_LEVEL: 'silent' }),
  ).rejects.toThrow('BYPASSRLS');
});
