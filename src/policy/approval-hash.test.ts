import { expect, it } from 'vitest';
import { approvalHash } from './approval-hash.js';

it('gives the same hash for the same arguments in any key order, nested too', () => {
  const a = approvalHash('t', { a: 1, b: { x: [1, 2], y: 'z' } });
  const b = approvalHash('t', { b: { y: 'z', x: [1, 2] }, a: 1 });
  expect(a).toBe(b);
  expect(a).toMatch(/^[0-9a-f]{64}$/);
});

it('gives another hash when any argument, the tool, or an array order changes', () => {
  const base = approvalHash('t', { note: 'hello', list: [1, 2] });
  expect(approvalHash('t', { note: 'hello!', list: [1, 2] })).not.toBe(base);
  expect(approvalHash('t', { note: 'hello', list: [2, 1] })).not.toBe(base);
  expect(approvalHash('u', { note: 'hello', list: [1, 2] })).not.toBe(base);
  expect(approvalHash('t', { note: 'hello', list: [1, 2], extra: null })).not.toBe(base);
});
