import { describe, expect, it } from 'vitest';
import {
  checkIsolation,
  coverage,
  findTables,
  findUntestedTables,
} from '../../scripts/check-isolation-tests.mjs';

const covered = (table: string): string => `it('${table}', () => expectIsolated('${table}', ctx));`;

describe('findTables', () => {
  it('lists created tables, with or without schema and quotes', () => {
    const sql = [
      'CREATE TABLE messages (id int);',
      'create table if not exists public."notes" (id int);',
      'create table "app"."users" (id int);',
    ];
    expect(findTables(sql)).toEqual(['messages', 'notes', 'users']);
  });
  it('lists tables made by the query builder in a TypeScript migration', () => {
    const ts = `await db.schema
      .createTable('chat_notes')
      .addColumn('user_id', 'uuid')`;
    expect(findTables([ts])).toEqual(['chat_notes']);
  });
});

describe('findUntestedTables', () => {
  it('reports tables no isolation test covers', () => {
    expect(findUntestedTables(['messages', 'notes'], [covered('messages')])).toEqual(['notes']);
  });
  it('matches the whole table name only', () => {
    expect(findUntestedTables(['user'], [covered('users')])).toEqual(['user']);
  });
  it('does not count a table that is only named, with no assertion on the other user', () => {
    expect(findUntestedTables(['notes'], ["describe('notes', () => {})"])).toEqual(['notes']);
    expect(findUntestedTables(['notes'], ["const t = 'notes'; // expectIsolated later"])).toEqual([
      'notes',
    ]);
  });
});

describe('coverage', () => {
  it('names the test file that covers each table', () => {
    const tests = [
      { name: 'a.isolation.test.ts', source: covered('turns') },
      { name: 'b.isolation.test.ts', source: covered('approvals') },
    ];
    expect(coverage(['approvals', 'turns', 'notes'], tests)).toEqual([
      { table: 'approvals', file: 'b.isolation.test.ts' },
      { table: 'turns', file: 'a.isolation.test.ts' },
      { table: 'notes', file: undefined },
    ]);
  });
});

describe('checkIsolation', () => {
  const tests = [{ name: 'x.isolation.test.ts', source: covered('turns') }];
  const migrations = ["createTable('turns')", "createTable('notes')", "createTable('workspaces')"];

  it('fails a new table that has user_id and no isolation test', () => {
    const result = checkIsolation({ migrations, tests, exempt: ['workspaces'] });
    expect(result.missing).toEqual(['notes']);
  });
  it('skips an exempt table', () => {
    const result = checkIsolation({ migrations, tests, exempt: ['workspaces', 'notes'] });
    expect(result.missing).toEqual([]);
    expect(result.rows.map((row) => row.table)).toEqual(['turns']);
  });
  it('fails a table that a test file only names, without an assertion on another user', () => {
    const named = [
      { name: 'y.isolation.test.ts', source: "describe('notes isolation', () => {})" },
    ];
    const result = checkIsolation({
      migrations,
      tests: [...tests, ...named],
      exempt: ['workspaces'],
    });
    expect(result.missing).toEqual(['notes']);
  });
  it('passes when every user-data table is covered', () => {
    const both = [...tests, { name: 'z.isolation.test.ts', source: covered('notes') }];
    expect(checkIsolation({ migrations, tests: both, exempt: ['workspaces'] }).missing).toEqual([]);
  });
});
