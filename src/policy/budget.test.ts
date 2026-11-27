import { expect, it } from 'vitest';
import { formatUsd, fromUnits, monthKey, toUnits } from './budget.js';

it('reads a decimal string as whole units of 1e-8 without a float', () => {
  expect(toUnits('1')).toBe(100_000_000n);
  expect(toUnits('0.25000000')).toBe(25_000_000n);
  expect(toUnits('12.5')).toBe(1_250_000_000n);
  expect(toUnits('0.00000001')).toBe(1n);
  expect(toUnits('0')).toBe(0n);
});

it('writes units back as a decimal with 8 places', () => {
  expect(fromUnits(500_000_000n)).toBe('5.00000000');
  expect(fromUnits(1n)).toBe('0.00000001');
  expect(fromUnits(0n)).toBe('0.00000000');
});

it('shows money to two places, rounded half up', () => {
  expect(formatUsd('5')).toBe('$5.00');
  expect(formatUsd('0.004')).toBe('$0.00');
  expect(formatUsd('0.005')).toBe('$0.01');
  expect(formatUsd('1234.5')).toBe('$1234.50');
});

it('names the local month, not the UTC one', () => {
  const edge = new Date('2026-11-30T23:30:00Z');
  expect(monthKey(edge, 'UTC')).toBe('2026-11');
  expect(monthKey(edge, 'Asia/Riyadh')).toBe('2026-12');
});
