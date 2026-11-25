import { describe, expect, it } from 'vitest';
import { clamp } from './clamp.js';

describe('clamp', () => {
  it('keeps a value that is already in range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('raises a value below the minimum', () => {
    expect(clamp(-3, 0, 10)).toBe(0);
  });

  it('lowers a value above the maximum', () => {
    expect(clamp(42, 0, 10)).toBe(10);
  });
});
