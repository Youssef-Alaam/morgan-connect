import { expect, it } from 'vitest';
import { formatUsage, roundDecimal } from './usage-report.js';

it('shows today and this month with cost, calls and tokens', () => {
  const text = formatUsage(
    {
      today: { calls: 1, inputTokens: 1234, outputTokens: 56, costUsd: '0.01234000' },
      month: { calls: 12, inputTokens: 100_000, outputTokens: 2000, costUsd: '1.50000000' },
    },
    'Asia/Riyadh',
  );
  expect(text).toBe(
    [
      'Usage (Asia/Riyadh)',
      'Today: $0.0123, 1 call, 1,234 tokens in, 56 out',
      'This month: $1.5000, 12 calls, 100,000 tokens in, 2,000 out',
    ].join('\n'),
  );
});

it('rounds decimal strings half up without floats', () => {
  expect(roundDecimal('0', 4)).toBe('0.0000');
  expect(roundDecimal('0.00005000', 4)).toBe('0.0001');
  expect(roundDecimal('0.00004999', 4)).toBe('0.0000');
  expect(roundDecimal('1.00005', 4)).toBe('1.0001');
  expect(roundDecimal('9.99995000', 4)).toBe('10.0000');
  expect(roundDecimal('1.5', 4)).toBe('1.5000');
  expect(roundDecimal('123456789.12345678', 4)).toBe('123456789.1235');
});
