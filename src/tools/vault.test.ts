import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { commitUrl, createVault, type GitRunner, runGit, VaultError } from './vault.js';

const TOKEN = 'not-a-real-token';
const PATH = '_inbox/2026-11-26-first-idea.md';
let root: string;
let remote: string;

const git = (cwd: string, ...args: string[]): string =>
  execFileSync(
    'git',
    ['-c', 'user.name=T', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8' },
  );

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vault-test-'));
  remote = join(root, 'remote.git');
  git(root, 'init', '--quiet', '--bare', '-b', 'main', remote);
  const seed = join(root, 'seed');
  git(root, 'clone', '--quiet', remote, seed);
  git(seed, 'checkout', '-q', '-b', 'main');
  git(seed, 'commit', '--quiet', '--allow-empty', '-m', 'init');
  git(seed, 'push', '--quiet', 'origin', 'main');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const vaultIn = (name: string, extra: { git?: GitRunner } = {}) =>
  createVault({ remoteUrl: remote, token: TOKEN, branch: 'main', dir: join(root, name), ...extra });
const commits = (): string[] => git(remote, 'log', '--format=%s', 'main').trim().split('\n');
const refused = (promise: Promise<unknown>): Promise<VaultError> =>
  promise.then(
    () => {
      throw new Error('should have been refused');
    },
    (error: unknown) => {
      expect(error).toBeInstanceOf(VaultError);
      return error as VaultError;
    },
  );
/** Runs `before` once, just ahead of the first push: the moment the remote can move. */
const beforeFirstPush = (before: () => Promise<unknown>): GitRunner => {
  let done = false;
  return async (cwd, args, env) => {
    if (!done && args.includes('push')) {
      done = true;
      await before();
    }
    return runGit(cwd, args, env);
  };
};

it('creates one new file and one commit', async () => {
  const done = await vaultIn('clone').capture(PATH, 'hello\n');
  expect(commits()).toEqual([`capture: ${PATH}`, 'init']);
  expect(git(remote, 'show', `main:${PATH}`)).toBe('hello\n');
  expect(done).toMatchObject({ path: PATH, sha: git(remote, 'rev-parse', 'main').trim() });
});

it('refuses an existing path and never overwrites it', async () => {
  const vault = vaultIn('clone');
  await vault.capture(PATH, 'first');
  expect((await refused(vault.capture(PATH, 'second'))).kind).toBe('refused');
  expect(git(remote, 'show', `main:${PATH}`)).toBe('first');
  expect(commits()).toHaveLength(2);
});

it.each([
  'notes/2026-11-26-x.md',
  '_inbox/../2026-11-26-x.md',
  '_inbox/sub/2026-11-26-x.md',
  '/etc/2026-11-26-x.md',
  '_inbox/2026-11-26-x.txt',
  '_inbox/x.md',
])('refuses the path %s', async (path) => {
  expect((await refused(vaultIn('clone').capture(path, 'x'))).kind).toBe('refused');
  expect(commits()).toEqual(['init']);
});

it('retries a push after the remote moved, with no duplicate commit', async () => {
  const moveRemote = () => {
    const other = join(root, 'other');
    git(root, 'clone', '--quiet', remote, other);
    git(other, 'commit', '--quiet', '--allow-empty', '-m', 'someone else');
    git(other, 'push', '--quiet', 'origin', 'main');
    return Promise.resolve();
  };
  await vaultIn('clone', { git: beforeFirstPush(moveRemote) }).capture(PATH, 'x');
  expect(commits()).toEqual([`capture: ${PATH}`, 'someone else', 'init']);
});

it('refuses, and leaves the remote alone, when someone added the same path meanwhile', async () => {
  const theirs = () => vaultIn('theirs').capture(PATH, 'theirs');
  const error = await refused(
    vaultIn('clone', { git: beforeFirstPush(theirs) }).capture(PATH, 'mine'),
  );
  expect(error.kind).toBe('refused');
  expect(git(remote, 'show', `main:${PATH}`)).toBe('theirs');
  expect(commits()).toHaveLength(2);
});

it('never shows the token in an error, the commit, or the saved clone settings', async () => {
  const leaky: GitRunner = (cwd, args, env) =>
    args.includes('push')
      ? Promise.reject(new Error(`denied for https://user:${TOKEN}@host ${TOKEN}`))
      : runGit(cwd, args, env);
  const error = await refused(vaultIn('clone', { git: leaky }).capture(PATH, 'x'));
  expect(error.message).not.toContain(TOKEN);
  expect(error.message).not.toContain('user:');
  expect(readFileSync(join(root, 'clone', '.git', 'config'), 'utf8')).not.toContain(TOKEN);
  expect(git(join(root, 'clone'), 'log', '--format=%an %ae %B')).not.toContain(TOKEN);
});

it('reports a clone failure without the token', async () => {
  const vault = createVault({
    remoteUrl: join(root, 'missing.git'),
    token: TOKEN,
    branch: 'main',
    dir: join(root, 'clone'),
  });
  expect((await refused(vault.capture(PATH, 'x'))).message).toContain('git clone failed');
});

it('links the commit only for a GitHub remote', () => {
  expect(commitUrl('https://github.com/me/vault.git', 'abc')).toBe(
    'https://github.com/me/vault/commit/abc',
  );
  expect(commitUrl('https://example.com/me/vault.git', 'abc')).toBeUndefined();
  expect(commitUrl('https://user:pw@github.com/me/vault.git', 'abc')).toBeUndefined();
});
