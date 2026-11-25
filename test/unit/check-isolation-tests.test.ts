import { describe, expect, it } from 'vitest';
import { findTables, findUntestedTables } from '../../scripts/check-isolation-tests.mjs';

describe('findTables', () => {
  it('lists created tables, with or without schema and quotes', () => {
    const sql = [
      'CREATE TABLE messages (id int);',
      'create table if not exists public."notes" (id int);',
    ];
    expect(findTables(sql)).toEqual(['messages', 'notes']);
  });
});

describe('findUntestedTables', () => {
  it('reports tables no isolation test mentions', () => {
    expect(findUntestedTables(['messages', 'notes'], ["isolation of 'messages'"])).toEqual([
      'notes',
    ]);
  });
});
