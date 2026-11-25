import { sql } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { appendAudit, createDb, migrateToLatest, type Db } from '../../src/data/index.js';
import { startPostgres, type TestPostgres } from '../helpers/postgres.js';

const USER = '00000000-0000-0000-0000-0000000000b1';
let postgres: TestPostgres;
let db: Db;

beforeAll(async () => {
  postgres = await startPostgres();
  db = createDb(postgres.url);
  await migrateToLatest(db);
  await sql`insert into users (id) values (${USER})`.execute(db);
  await sql`insert into devices (user_id, channel, chat_id) values (${USER}, 'fake', 'linked')`.execute(
    db,
  );
}, 180_000);

afterAll(async () => {
  await db.destroy();
  await postgres.stop();
});

const entry = (chatId: string): Parameters<typeof appendAudit>[1] => ({
  channel: 'fake',
  chatId,
  tool: 'clock.now',
  actionType: 'read',
  changesState: false,
  argNames: ['timezone'],
  decision: 'auto',
  outcome: 'ok',
});

it('adds a row with the person from the linked chat, and none for an unlinked chat', async () => {
  await appendAudit(db, entry('linked'));
  await appendAudit(db, entry('stranger'));
  const rows = await db
    .selectFrom('audit_log')
    .select(['chat_id', 'user_id'])
    .orderBy('id')
    .execute();
  expect(rows).toEqual([
    { chat_id: 'linked', user_id: USER },
    { chat_id: 'stranger', user_id: null },
  ]);
});

it('refuses to update, delete or truncate an audit row, and a bad decision', async () => {
  await expect(sql`update audit_log set tool = 'x'`.execute(db)).rejects.toThrow('append-only');
  await expect(sql`delete from audit_log`.execute(db)).rejects.toThrow('append-only');
  await expect(sql`truncate audit_log`.execute(db)).rejects.toThrow('append-only');
  await expect(
    appendAudit(db, { ...entry('linked'), decision: 'maybe' as 'auto' }),
  ).rejects.toThrow();
  expect(await db.selectFrom('audit_log').select('id').execute()).toHaveLength(2);
});
