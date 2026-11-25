import { describe, expect, it } from 'vitest';
import { findTables, findUntestedTables } from '../../scripts/check-isolation-tests.mjs';

describe('findTables', () => {
  it('lists created tables, with or without schema and quotes', () => {
    const sql = [
      'CREATE TABLE messages (id int);',
      'create table if not exists public."notes" (id int);',
      'create table "app"."users" (id int);',
    ];
    expect(findTables(sql)).toEqual(['messages', 'notes', 'users']);
  });
});

describe('findUntestedTables', () => {
  it('reports tables no isolation test mentions', () => {
    expect(findUntestedTables(['messages', 'notes'], ["isolation of 'messages'"])).toEqual([
      'notes',
    ]);
  });
  it('matches whole words only', () => {
    expect(findUntestedTables(['user'], ["describe('users isolation')"])).toEqual(['user']);
    expect(findUntestedTables(['user'], ['xuser_id'])).toEqual(['user']);
  });
  it('accepts a describe block named after the table', () => {
    expect(findUntestedTables(['user'], ["describe('user isolation', () => {})"])).toEqual([]);
    expect(findUntestedTables(['user'], ['select * from "app"."user"'])).toEqual([]);
  });
});
