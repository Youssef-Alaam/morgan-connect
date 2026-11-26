import { expect, it } from 'vitest';
import { createChallenges } from './passkeys.js';

it('hands a challenge out once, to the person it was made for', () => {
  const challenges = createChallenges(() => 0);
  challenges.put('a', 'alice');
  expect(challenges.take('a', 'bob')).toBe(false);
  // Wrongly asked for, it is gone: a guess cannot be retried.
  expect(challenges.take('a', 'alice')).toBe(false);
  challenges.put('b', 'alice');
  expect(challenges.take('b', 'alice')).toBe(true);
  expect(challenges.take('b', 'alice')).toBe(false);
  challenges.put('c');
  expect(challenges.take('c', 'alice')).toBe(false);
  challenges.put('d');
  expect(challenges.take('d')).toBe(true);
});

it('lets a challenge expire and forgets the oldest when full', () => {
  let now = 0;
  const challenges = createChallenges(() => now);
  challenges.put('old');
  now += 6 * 60_000;
  expect(challenges.take('old')).toBe(false);
  for (let i = 0; i < 1001; i++) challenges.put(`c${String(i)}`);
  expect(challenges.take('c0')).toBe(false);
  expect(challenges.take('c1000')).toBe(true);
  expect(challenges.take('c1')).toBe(true);
});
