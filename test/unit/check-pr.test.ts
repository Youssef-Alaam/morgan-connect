import { describe, expect, it } from 'vitest';
import {
  addedDependencies,
  changedLineCount,
  evaluatePr,
  hasTicketId,
  missingDependencyLines,
  srcChangedWithoutTest,
} from '../../scripts/check-pr.mjs';

const file = (filename: string, additions = 1, deletions = 0, status?: string) => ({
  filename,
  additions,
  deletions,
  ...(status === undefined ? {} : { status }),
});

describe('hasTicketId', () => {
  it.each(['M0-3: CI pipeline', 'M12-40: x', 'M2-13a: tokens'])('accepts %s', (title) => {
    expect(hasTicketId(title)).toBe(true);
  });
  it.each(['CI pipeline', 'm0-3: x', 'fix M0-3: x', 'M0-3 CI', 'M0: x', 'M2-13ab: x', 'M2-13A: x'])(
    'rejects %s',
    (title) => {
      expect(hasTicketId(title)).toBe(false);
    },
  );
});

describe('changedLineCount', () => {
  it('sums additions and deletions', () => {
    expect(changedLineCount([file('src/a.ts', 10, 5), file('README.md', 2, 3)])).toBe(20);
  });
  it('excludes lockfile, snapshots and fixtures', () => {
    const files = [
      file('package-lock.json', 5000, 100),
      file('test/unit/__snapshots__/a.snap', 300),
      file('test/fixtures/big/data.json', 900),
      file('src/a.ts', 7),
    ];
    expect(changedLineCount(files)).toBe(7);
  });
  it('counts .snap files outside a __snapshots__ directory', () => {
    expect(changedLineCount([file('test/unit/a.test.ts.snap', 300)])).toBe(300);
    expect(changedLineCount([file('src/__snapshots__/notes.md', 40)])).toBe(40);
  });
});

describe('srcChangedWithoutTest', () => {
  it('is false when no src file changed', () => {
    expect(srcChangedWithoutTest([file('README.md')])).toBe(false);
  });
  it('is true when src changed and no test file did', () => {
    expect(srcChangedWithoutTest([file('src/core/a.ts')])).toBe(true);
  });
  it('is false when a test under test/ changed too', () => {
    expect(srcChangedWithoutTest([file('src/core/a.ts'), file('test/unit/a.test.ts')])).toBe(false);
  });
  it('does not count a changed test under src as a src change needing a test', () => {
    expect(srcChangedWithoutTest([file('src/core/a.test.ts')])).toBe(false);
  });
  it('accepts a sibling test next to the changed src file', () => {
    expect(srcChangedWithoutTest([file('src/core/a.ts'), file('src/core/a.test.ts')])).toBe(false);
  });
  it('rejects a test in an unrelated src directory', () => {
    expect(srcChangedWithoutTest([file('src/core/a.ts'), file('src/other/b.test.ts')])).toBe(true);
  });
  it('skips the rule when src changes are deletions only', () => {
    expect(srcChangedWithoutTest([file('src/core/a.ts', 0, 9, 'D')])).toBe(false);
  });
  it('still needs a test when src is modified next to a deletion', () => {
    expect(
      srcChangedWithoutTest([file('src/core/a.ts', 0, 9, 'D'), file('src/core/b.ts', 3, 1, 'M')]),
    ).toBe(true);
  });
  it('does not count a deleted test file', () => {
    expect(
      srcChangedWithoutTest([file('src/a.ts', 1, 0, 'A'), file('test/unit/a.test.ts', 0, 5, 'D')]),
    ).toBe(true);
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
});

describe('missingDependencyLines', () => {
  it('finds a line per package', () => {
    const body = '- thing\nDependency: foo, because bar\nDependency: @scope/baz: why';
    expect(missingDependencyLines(body, ['foo', '@scope/baz'])).toEqual([]);
  });
  it('reports packages without their own line', () => {
    expect(missingDependencyLines('Dependency: foo', ['foo', 'bar'])).toEqual(['bar']);
    expect(missingDependencyLines('Dependency:   ', ['foo'])).toEqual(['foo']);
    expect(missingDependencyLines('', ['foo'])).toEqual(['foo']);
  });
  it('matches the whole package name', () => {
    expect(missingDependencyLines('Dependency: foobar', ['foo'])).toEqual(['foo']);
    expect(missingDependencyLines('Dependency: foo-extra', ['foo'])).toEqual(['foo']);
  });
  it('ignores lines inside fenced code blocks', () => {
    const body = '```\nDependency: foo\n```\n~~~md\nDependency: bar\n~~~\nDependency: baz';
    expect(missingDependencyLines(body, ['foo', 'bar', 'baz'])).toEqual(['foo', 'bar']);
  });
  it('needs nothing when no package was added', () => {
    expect(missingDependencyLines('', [])).toEqual([]);
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
  it('asks for one Dependency line per added package', () => {
    const headPackage = { dependencies: { x: '1', y: '1' } };
    expect(evaluatePr({ ...clean, body: 'Dependency: x', headPackage })).toHaveLength(1);
    expect(evaluatePr({ ...clean, body: 'Dependency: x\nDependency: y', headPackage })).toEqual([]);
  });
  it('fails a PR over 400 lines but allows exactly 400', () => {
    expect(evaluatePr({ ...clean, files: [file('README.md', 401)] })).toHaveLength(1);
    expect(evaluatePr({ ...clean, files: [file('README.md', 400)] })).toEqual([]);
  });
});
