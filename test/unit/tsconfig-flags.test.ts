import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const REQUIRED_TRUE_FLAGS = [
  'strict',
  'noUncheckedIndexedAccess',
  'exactOptionalPropertyTypes',
  'noImplicitOverride',
  'noImplicitReturns',
  'noFallthroughCasesInSwitch',
  'noPropertyAccessFromIndexSignature',
  'noUnusedLocals',
  'noUnusedParameters',
  'verbatimModuleSyntax',
  'isolatedModules',
  'forceConsistentCasingInFileNames',
] as const;

function readCompilerOptions(): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync('tsconfig.json', 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || !('compilerOptions' in parsed)) {
    throw new Error('tsconfig.json has no compilerOptions');
  }
  return parsed.compilerOptions as Record<string, unknown>;
}

describe('tsconfig.json strict flags (STANDARDS section 1)', () => {
  const options = readCompilerOptions();

  it.each(REQUIRED_TRUE_FLAGS)('%s is true', (flag) => {
    expect(options[flag]).toBe(true);
  });

  it('allowUnreachableCode is false', () => {
    expect(options['allowUnreachableCode']).toBe(false);
  });
});
