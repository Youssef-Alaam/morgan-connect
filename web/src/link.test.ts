import { describe, expect, it } from 'vitest';
import { tokenFromHash } from './link.ts';

describe('tokenFromHash', () => {
  it.each([
    ['#token=abc-123_XYZ', 'abc-123_XYZ'],
    ['token=abc', 'abc'],
    ['#other=1&token=t2', 't2'],
    ['', ''],
    ['#nothing', ''],
  ])('reads %j as %j', (hash, expected) => {
    expect(tokenFromHash(hash)).toBe(expected);
  });
});
