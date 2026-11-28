import { describe, expect, it } from 'vitest';
import {
  checkOptionalImports,
  importedPackages,
  isAdapterPath,
} from '../../scripts/check-optional-imports.mjs';

describe('importedPackages', () => {
  it('finds static, side-effect, dynamic, require and re-export specifiers', () => {
    const source = [
      `import a from 'alpha';`,
      `import { b } from "@scope/beta/sub";`,
      `import 'gamma';`,
      `const d = await import('delta');`,
      `const e = require('epsilon');`,
      `export * from 'zeta';`,
      `import local from './local.js';`,
      `import fs from 'node:fs';`,
    ].join('\n');
    expect(importedPackages(source)).toEqual([
      'alpha',
      '@scope/beta',
      'gamma',
      'delta',
      'epsilon',
      'zeta',
    ]);
  });
});

describe('isAdapterPath', () => {
  it('accepts files under an optional adapter folder only', () => {
    expect(isAdapterPath('src/engines/optional/claude/index.ts')).toBe(true);
    expect(isAdapterPath('src/engines/index.ts')).toBe(false);
  });
});

describe('checkOptionalImports', () => {
  const optional = ['@closed/sdk'];
  it('passes when no optional package is imported', () => {
    const files = [{ name: 'src/main.ts', source: `import x from 'hono';` }];
    expect(checkOptionalImports(files, optional)).toEqual([]);
  });
  it('passes when there are no optional packages at all', () => {
    const files = [{ name: 'src/a.ts', source: `import x from 'y';` }];
    expect(checkOptionalImports(files, [])).toEqual([]);
  });
  it('fails an import from a non-adapter module, naming the file and the package', () => {
    const files = [{ name: 'src/core/turn.ts', source: `import { q } from '@closed/sdk/query';` }];
    expect(checkOptionalImports(files, optional)).toEqual([
      { file: 'src/core/turn.ts', pkg: '@closed/sdk' },
    ]);
  });
  it('allows the import inside an optional adapter folder', () => {
    const files = [
      { name: 'src/engines/optional/claude/run.ts', source: `import { q } from '@closed/sdk';` },
    ];
    expect(checkOptionalImports(files, optional)).toEqual([]);
  });
});
