import { describe, expect, it } from 'vitest';
import { plus, reached, usd } from './money.ts';

describe('usd', () => {
  it('shows cents, rounded half up, from the exact decimal string', () => {
    expect(usd('0')).toBe('$0.00');
    expect(usd('1.50000000')).toBe('$1.50');
    expect(usd('0.005')).toBe('$0.01');
    expect(usd('0.00499999')).toBe('$0.00');
    expect(usd('1234.5')).toBe('$1234.50');
  });

  it('leaves anything that is not a plain decimal as it came', () => {
    expect(usd('lots')).toBe('lots');
  });
});

describe('plus and reached', () => {
  it('adds without a float', () => {
    expect(plus('0.1', '0.2')).toBe('0.30000000');
    expect(plus('12.5', '5.00000000')).toBe('17.50000000');
  });

  it('counts reaching the limit exactly as over it', () => {
    expect(reached('5', '5.00000000')).toBe(true);
    expect(reached('4.99999999', '5')).toBe(false);
  });
});
