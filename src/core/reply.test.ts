import { expect, it } from 'vitest';
import { assertFitsJobExpiry } from './reply.js';

it('accepts a time limit that ends before the job expires', () => {
  expect(() => {
    assertFitsJobExpiry({ turnTimeoutMs: 120_000, retryDelayMs: 2000 }, 300);
  }).not.toThrow();
});

it('refuses a time limit plus retry waits that reaches the job expiry', () => {
  expect(() => {
    assertFitsJobExpiry({ turnTimeoutMs: 295_000, retryDelayMs: 2000 }, 300);
  }).toThrow(/job expiry/);
});
