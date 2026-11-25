// PR shape check (STANDARDS sections 3, 5, 11). Pure functions plus a thin main.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const MAX_CHANGED_LINES = 400;
const DEP_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies'];

export function hasTicketId(title) {
  return /^M\d+-\d+:/.test(title);
}

function isExcludedFromSize(filename) {
  return (
    filename === 'package-lock.json' ||
    filename.endsWith('.snap') ||
    filename.includes('__snapshots__/') ||
    filename.startsWith('test/fixtures/')
  );
}

export function changedLineCount(files) {
  return files
    .filter((f) => !isExcludedFromSize(f.filename))
    .reduce((sum, f) => sum + f.additions + f.deletions, 0);
}

const isTestFile = (filename) => filename.endsWith('.test.ts');

export function srcChangedWithoutTest(files) {
  const srcChanged = files.some((f) => f.filename.startsWith('src/') && !isTestFile(f.filename));
  return srcChanged && !files.some((f) => isTestFile(f.filename));
}

export function addedDependencies(base, head) {
  const added = [];
  for (const section of DEP_SECTIONS) {
    const before = base[section] ?? {};
    for (const name of Object.keys(head[section] ?? {})) {
      if (!(name in before)) added.push(name);
    }
  }
  return added.sort();
}

export function hasDependencyLine(body) {
  return /^Dependency:[ \t]*\S/m.test(body);
}

export function evaluatePr({ title, body, files, basePackage, headPackage }) {
  const errors = [];
  if (!hasTicketId(title)) {
    errors.push(`PR title must start with a ticket id like "M0-3:" (got "${title}").`);
  }
  const lines = changedLineCount(files);
  if (lines > MAX_CHANGED_LINES) {
    errors.push(`PR changes ${lines} lines; the limit is ${MAX_CHANGED_LINES}.`);
  }
  if (srcChangedWithoutTest(files)) {
    errors.push('A file under src/ changed but no *.test.ts file did (test-first rule).');
  }
  const added = addedDependencies(basePackage, headPackage);
  if (added.length > 0 && !hasDependencyLine(body)) {
    errors.push(`package.json adds ${added.join(', ')}; the PR body needs a "Dependency:" line.`);
  }
  return errors;
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function readChangedFiles(baseSha) {
  return git('diff', '--numstat', baseSha, 'HEAD')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [add, del, ...name] = line.split('\t');
      return {
        filename: name.join('\t'),
        additions: Number(add) || 0,
        deletions: Number(del) || 0,
      };
    });
}

function main() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath === undefined) throw new Error('GITHUB_EVENT_PATH is not set; run in CI.');
  const event = JSON.parse(readFileSync(eventPath, 'utf8'));
  if (event.pull_request === undefined) {
    console.log('Not a pull request; PR shape check skipped.');
    return;
  }
  const pr = event.pull_request;
  const errors = evaluatePr({
    title: pr.title ?? '',
    body: pr.body ?? '',
    files: readChangedFiles(pr.base.sha),
    basePackage: JSON.parse(git('show', `${pr.base.sha}:package.json`)),
    headPackage: JSON.parse(readFileSync('package.json', 'utf8')),
  });
  for (const message of errors) console.error(`::error::${message}`);
  if (errors.length > 0) process.exit(1);
  console.log('PR shape OK.');
}

if (process.argv[1]?.endsWith('check-pr.mjs')) {
  main();
}
