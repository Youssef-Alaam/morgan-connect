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
    (filename.endsWith('.snap') && filename.includes('__snapshots__/')) ||
    filename.startsWith('test/fixtures/')
  );
}

export function changedLineCount(files) {
  return files
    .filter((f) => !isExcludedFromSize(f.filename))
    .reduce((sum, f) => sum + f.additions + f.deletions, 0);
}

const isTestFile = (filename) => filename.endsWith('.test.ts');
const dirOf = (filename) => filename.slice(0, filename.lastIndexOf('/') + 1);

// Deleted files (status "D") neither need a test nor count as one.
export function srcChangedWithoutTest(files) {
  const live = files.filter((f) => f.status !== 'D');
  const srcFiles = live.filter((f) => f.filename.startsWith('src/') && !isTestFile(f.filename));
  if (srcFiles.length === 0) return false;
  const srcDirs = new Set(srcFiles.map((f) => dirOf(f.filename)));
  return !live.some(
    (f) =>
      isTestFile(f.filename) && (f.filename.startsWith('test/') || srcDirs.has(dirOf(f.filename))),
  );
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

function stripFencedCode(body) {
  let fence = null;
  const kept = [];
  for (const line of body.split('\n')) {
    const marker = /^[ \t]*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence === null && marker !== undefined) {
      fence = marker;
    } else if (fence !== null && marker?.startsWith(fence)) {
      fence = null;
    } else if (fence === null) {
      kept.push(line);
    }
  }
  return kept.join('\n');
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// One "Dependency: <name> ..." line per added package; fenced code is ignored.
export function missingDependencyLines(body, names) {
  const lines = stripFencedCode(body)
    .split('\n')
    .map((line) => /^Dependency:[ \t]*(.*)$/.exec(line.trim())?.[1])
    .filter((rest) => rest !== undefined);
  return names.filter((name) => {
    const pattern = new RegExp(`^${escapeRegExp(name)}(?![\\w@/.-])`);
    return !lines.some((rest) => pattern.test(rest));
  });
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
    errors.push('A file under src/ changed but no matching *.test.ts file did (test-first rule).');
  }
  const added = addedDependencies(basePackage, headPackage);
  for (const name of missingDependencyLines(body, added)) {
    errors.push(`package.json adds ${name}; the PR body needs a "Dependency: ${name}" line.`);
  }
  return errors;
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function readChangedFiles(range) {
  const status = new Map();
  for (const line of git('diff', '--name-status', '--no-renames', range).split('\n')) {
    const [code, ...name] = line.split('\t');
    if (name.length > 0) status.set(name.join('\t'), code);
  }
  return git('diff', '--numstat', '--no-renames', range)
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [add, del, ...parts] = line.split('\t');
      const filename = parts.join('\t');
      return {
        filename,
        status: status.get(filename),
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
    files: readChangedFiles(`${pr.base.sha}...${pr.head.sha}`),
    basePackage: JSON.parse(git('show', `${pr.base.sha}:package.json`)),
    headPackage: JSON.parse(git('show', `${pr.head.sha}:package.json`)),
  });
  for (const message of errors) console.error(`::error::${message}`);
  if (errors.length > 0) process.exit(1);
  console.log('PR shape OK.');
}

if (process.argv[1]?.endsWith('check-pr.mjs')) {
  main();
}
