import { expect, it } from 'vitest';
import { parseEvalArgs } from './args.js';
import { DEV_SCENARIOS } from './scenarios.js';

it('defaults to a cheap model and a two dollar cap', () => {
  expect(parseEvalArgs(['--set', 'dev'])).toEqual({
    set: 'dev',
    model: 'claude-haiku-5-5',
    capUsd: 2,
  });
});

it('takes a model and a cap, and refuses anything else', () => {
  expect(parseEvalArgs(['--set', 'dev', '--model', 'm', '--cap', '0.5'])).toMatchObject({
    model: 'm',
    capUsd: 0.5,
  });
  expect(() => parseEvalArgs([])).toThrow('--set dev');
  expect(() => parseEvalArgs(['--set', 'holdout'])).toThrow('--set dev');
  expect(() => parseEvalArgs(['--set', 'dev', '--cap', 'x'])).toThrow('--cap');
  expect(() => parseEvalArgs(['--set', 'dev', '--cap', '0'])).toThrow('--cap');
});

it('has the five dev scenarios with unique names', () => {
  expect(new Set(DEV_SCENARIOS.map((s) => s.name)).size).toBe(5);
});
