import { expect, it } from 'vitest';
import { toUnits } from './budget.js';

it('reads a decimal string as whole units of 1e-8 without a float', () => {
  expect(toUnits('1')).toBe(100_000_000n);
  expect(toUnits('0.25000000')).toBe(25_000_000n);
  expect(toUnits('12.5')).toBe(1_250_000_000n);
  expect(toUnits('0.00000001')).toBe(1n);
  expect(toUnits('0')).toBe(0n);
});
