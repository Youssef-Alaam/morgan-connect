import { describe, expect, it } from 'vitest';
import {
  addedDependencies,
  changedLineCount,
  evaluatePr,
  hasDependencyLine,
  hasTicketId,
  srcChangedWithoutTest,
} from '../../scripts/check-pr.mjs';

const file = (filename: string, additions = 1, deletions = 0) => ({
  filename,
  additions,
  deletions,
});

describe('hasTicketId', () => {
  it.each(['M0-3: CI pipeline', 'M12-40: x'])('accepts %s', (title) => {
    expect(hasTicketId(title)).toBe(true);
  });
  it.each(['CI pipeline', 'm0-3: x', 'fix M0-3: x', 'M0-3 CI', 'M0: x'])('rejects %s', (title) => {
    expect(hasTicketId(title)).toBe(false);
  });
});

describe('changedLineCount', () => {
  it('sums additions and deletions', () => {
    expect(changedLineCount([file('src/a.ts', 10, 5), file('README.md', 2, 3)])).toBe(20);
  });
  it('excludes lockfile, snapshots and fixtures', () => {
    const files = [
      file('package-lock.json', 5000, 100),
      file('test/unit/__snapshots__/a.snap', 300),
      file('test/unit/a.test.ts.snap', 300),
      file('test/fixtures/big/data.json', 900),
      file('src/a.ts', 7),
    ];
    expect(changedLineCount(files)).toBe(7);
  });
});

describe('srcChangedWithoutTest', () => {
  it('is false when no src file changed', () => {
    expect(srcChangedWithoutTest([file('README.md')])).toBe(false);
  });
  it('is true when src changed and no test file did', () => {
    expect(srcChangedWithoutTest([file('src/core/a.ts')])).toBe(true);
  });
  it('is false when a test file changed too', () => {
    expect(srcChangedWithoutTest([file('src/core/a.ts'), file('test/unit/a.test.ts')])).toBe(false);
  });
  it('does not count a changed test under src as a src change needing a test', () => {
    expect(srcChangedWithoutTest([file('src/core/a.test.ts')])).toBe(false);
  });
});

describe('addedDependencies', () => {
  const base = { dependencies: { a: '1' }, devDependencies: { b: '1' } };
  it('finds new deps and devDeps', () => {
    const head = { dependencies: { a: '1', c: '1' }, devDependencies: { b: '2', d: '1' } };
    expect(addedDependencies(base, head)).toEqual(['c', 'd']);
  });
  it('ignores version bumps and removals', () => {
    expect(addedDependencies(base, { dependencies: { a: '2' } })).toEqual([]);
  });
  it('handles missing sections', () => {
    expect(addedDependencies({}, { devDependencies: { x: '1' } })).toEqual(['x']);
  });
});

describe('hasDependencyLine', () => {
  it('finds a Dependency line', () => {
    expect(hasDependencyLine('- thing\nDependency: foo, because bar')).toBe(true);
  });
  it('rejects an empty or missing line', () => {
    expect(hasDependencyLine('Dependency:   ')).toBe(false);
    expect(hasDependencyLine('no such line')).toBe(false);
    expect(hasDependencyLine('')).toBe(false);
  });
});

describe('evaluatePr', () => {
  const clean = {
    title: 'M0-3: CI pipeline',
    body: 'text',
    files: [file('src/a.ts'), file('test/unit/a.test.ts')],
    basePackage: {},
    headPackage: {},
  };
  it('passes a clean PR', () => {
    expect(evaluatePr(clean)).toEqual([]);
  });
  it('reports every broken rule', () => {
    const errors = evaluatePr({
      ...clean,
      title: 'oops',
      files: [file('src/a.ts', 500)],
      headPackage: { dependencies: { x: '1' } },
    });
    expect(errors).toHaveLength(4);
  });
  it('fails a PR over 400 lines but allows exactly 400', () => {
    expect(evaluatePr({ ...clean, files: [file('README.md', 401)] })).toHaveLength(1);
    expect(evaluatePr({ ...clean, files: [file('README.md', 400)] })).toEqual([]);
  });
  it('accepts a new dependency with a Dependency line', () => {
    const ok = {
      ...clean,
      body: 'Dependency: x - needed',
      headPackage: { dependencies: { x: '1' } },
    };
    expect(evaluatePr(ok)).toEqual([]);
  });
});
