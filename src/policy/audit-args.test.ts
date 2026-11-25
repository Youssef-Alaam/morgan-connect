import { describe, expect, it } from 'vitest';
import { summarizeArgs } from './audit-args.js';

const schema = { type: 'object', properties: { timezone: {}, note: {} } };

describe('summarizeArgs', () => {
  it('keeps only names the tool declares, counts the rest, and hashes the whole', () => {
    const summary = summarizeArgs({ timezone: 'x', secret_key: 'y', other: 'z' }, schema);
    expect(summary.argNames).toEqual(['timezone']);
    expect(summary.extraArgs).toBe(2);
    expect(summary.argsSha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it('the hash changes when a value changes, and never contains a value', () => {
    const a = summarizeArgs({ note: 'one' }, schema);
    const b = summarizeArgs({ note: 'two' }, schema);
    expect(a.argsSha256).not.toBe(b.argsSha256);
    expect(JSON.stringify(a)).not.toContain('one');
  });
  it('caps how many names are kept and how long each is', () => {
    const names = Array.from({ length: 30 }, (_, i) => `${'n'.repeat(80)}${String(i)}`);
    const properties = Object.fromEntries(names.map((n) => [n, {}]));
    const args = Object.fromEntries(names.map((n) => [n, 1]));
    const summary = summarizeArgs(args, { properties });
    expect(summary.argNames).toHaveLength(16);
    expect(summary.argNames.every((n) => n.length <= 40)).toBe(true);
    expect(summary.extraArgs).toBe(14);
  });
  it('treats a schema without properties as declaring nothing', () => {
    expect(summarizeArgs({ a: 1 }, {})).toMatchObject({ argNames: [], extraArgs: 1 });
  });
});
