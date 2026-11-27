import { describe, expect, it } from 'vitest';
import { limitOf } from './limit.ts';

describe('limitOf', () => {
  it('reads empty as no limit and a number as dollars', () => {
    expect(limitOf('')).toBeNull();
    expect(limitOf('   ')).toBeNull();
    expect(limitOf(' 7.5 ')).toBe(7.5);
  });

  it('leaves what is not a number for the server to refuse', () => {
    expect(limitOf('lots')).toBeNaN();
  });
});
