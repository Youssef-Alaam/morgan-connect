import { createRequire } from 'node:module';
import { expect, it } from 'vitest';

interface Rule {
  name: string;
  from: { path: string; pathNot?: string };
  to: { path: string };
}
const config = createRequire(import.meta.url)('../../.dependency-cruiser.cjs') as {
  forbidden: Rule[];
};
const rule = config.forbidden.find((r) => r.name === 'tools-only-from-policy');

it('only src/policy (and the tools themselves) may import a tool', () => {
  if (rule === undefined) throw new Error('the tools-only-from-policy rule is missing');
  const imports = (file: string): boolean =>
    new RegExp(rule.from.path).test(file) && !new RegExp(rule.from.pathNot ?? '$^').test(file);
  expect(imports('src/core/reply.ts')).toBe(true);
  expect(imports('src/providers/pi.ts')).toBe(true);
  expect(imports('src/boot.ts')).toBe(true);
  expect(imports('src/policy/gate.ts')).toBe(false);
  expect(new RegExp(rule.to.path).test('src/tools/clock.ts')).toBe(true);
});
