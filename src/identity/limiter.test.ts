import { expect, it } from 'vitest';
import { createFailureLimiter } from './limiter.js';

it('blocks a key after too many failures, and frees it when the window passes', () => {
  let now = 0;
  const limiter = createFailureLimiter({ max: 2, windowMs: 1000, now: () => now });
  expect(limiter.blocked('a')).toBe(false);
  limiter.fail('a');
  limiter.fail('a');
  expect(limiter.blocked('a')).toBe(true);
  expect(limiter.blocked('b')).toBe(false);
  now = 1001;
  expect(limiter.blocked('a')).toBe(false);
});

it('forgets a key on reset', () => {
  const limiter = createFailureLimiter({ max: 1, windowMs: 1000, now: () => 0 });
  limiter.fail('a');
  limiter.reset('a');
  expect(limiter.blocked('a')).toBe(false);
});
