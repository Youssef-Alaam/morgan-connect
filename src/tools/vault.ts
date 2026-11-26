import { execFile } from 'node:child_process';
import { lstat, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { atomicWrite } from '../ops/index.js';

/** Runs git with these arguments in `cwd` and returns its output. Tests wrap it to stage a race. */
export type GitRunner = (cwd: string, args: string[], env: NodeJS.ProcessEnv) => Promise<string>;

export interface VaultOptions {
  /** The vault repository, e.g. `https://github.com/owner/vault.git`. Must not carry a token. */
  remoteUrl: string;
  /** A fine-grained token with write access to that one repository. Never logged or committed. */
  token: string;
  branch: string;
  /** Where Morgan's own clone lives. */
  dir: string;
  git?: GitRunner;
}

interface Captured {
  path: string;
  sha: string;
  /** A link to the commit when the remote is on GitHub. */
  url?: string;
}

/** `refused`: the request is wrong. `failed`: git or the network failed. Messages never hold the token. */
export class VaultError extends Error {
  constructor(
    readonly kind: 'refused' | 'failed',
    message: string,
  ) {
    super(message);
  }
}

export interface Vault {
  /** Write one new note and push it as one commit. Never overwrites, never leaves `_inbox/`. */
  capture: (path: string, content: string) => Promise<Captured>;
}

/** `_inbox/` + date + slug: one folder level, no dots, no `..`, nothing to escape with. */
const INBOX_PATH = /^_inbox\/\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const PUSH_TRIES = 3;
const IDENTITY = ['-c', 'user.name=Morgan', '-c', 'user.email=morgan@users.noreply.github.com'];

export const runGit: GitRunner = (cwd, args, env) =>
  new Promise((resolve, reject) => {
    const options = { cwd, env, timeout: 60_000, maxBuffer: 4_000_000, windowsHide: true };
    execFile('git', args, options, (error, stdout, stderr) => {
      if (error === null) resolve(stdout);
      else reject(new Error(stderr.trim() === '' ? error.message : stderr.trim()));
    });
  });

/** The token travels in an environment header: not in a URL, an argument, or the saved config. */
function gitEnv(token: string): NodeJS.ProcessEnv {
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.extraHeader',
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
  };
}

const exists = (path: string): Promise<boolean> =>
  lstat(path).then(
    () => true,
    () => false,
  );

/** https://github.com/o/r(.git) becomes a commit link; any other remote gets none. */
export function commitUrl(remoteUrl: string, sha: string): string | undefined {
  const match = /^https:\/\/github\.com\/([^/\s@]+\/[^/\s@]+?)(?:\.git)?\/?$/.exec(remoteUrl);
  return match?.[1] === undefined ? undefined : `https://github.com/${match[1]}/commit/${sha}`;
}

interface PushParts {
  git: (args: string[]) => Promise<string>;
  fetch: () => Promise<string>;
  branch: string;
  remoteRef: string;
}

/** Push; when the remote moved, pull (rebase our one commit) and try again. */
async function pushWithRetry({ git, fetch, branch, remoteRef }: PushParts, path: string) {
  for (let attempt = 1; ; attempt++) {
    try {
      await git(['push', '--quiet', 'origin', `HEAD:refs/heads/${branch}`]);
      return;
    } catch (error) {
      if (attempt >= PUSH_TRIES) throw error;
    }
    await fetch();
    try {
      await git(['rebase', '--quiet', remoteRef]);
    } catch {
      await git(['rebase', '--abort']).catch(() => '');
      throw new VaultError('refused', `${path} changed on the remote; nothing was captured`);
    }
  }
}

/** Our own clone of the vault: every git call goes through here, so errors are scrubbed in one place. */
function createClone({ remoteUrl, token, branch, dir, git: run = runGit }: VaultOptions) {
  const env = gitEnv(token);
  const secrets = [token, env['GIT_CONFIG_VALUE_0'] ?? '', Buffer.from(token).toString('base64')];
  const scrub = (text: string): string =>
    secrets
      .reduce((out, secret) => out.replaceAll(secret, '[redacted]'), text)
      .replace(/\/\/[^/@\s]+@/g, '//');
  const fail = (what: string, error: unknown): VaultError => {
    const reason = error instanceof Error ? error.message : 'unknown error';
    return new VaultError('failed', scrub(`git ${what} failed: ${reason}`));
  };
  const git = (args: string[]): Promise<string> =>
    run(dir, [...IDENTITY, ...args], env).catch((error: unknown) => {
      throw fail(args[0] ?? '', error);
    });
  const remoteRef = `origin/${branch}`;
  const fetch = (): Promise<string> =>
    git(['fetch', '--quiet', 'origin', `+refs/heads/${branch}:refs/remotes/${remoteRef}`]);

  /** Our clone is disposable: make it match the remote exactly before writing anything. */
  async function sync(): Promise<void> {
    if (!(await exists(join(dir, '.git')))) {
      await mkdir(dirname(dir), { recursive: true });
      const clone = ['clone', '--quiet', '--branch', branch, '--single-branch', '--', remoteUrl];
      await run(dirname(dir), [...IDENTITY, ...clone, dir], env).catch((error: unknown) => {
        throw fail('clone', error);
      });
      return;
    }
    await fetch();
    await git(['reset', '--quiet', '--hard', remoteRef]);
    await git(['clean', '--quiet', '-fd']);
  }

  /** Commit the new file and push it. Returns the commit's sha. */
  async function commitAndPush(path: string): Promise<string> {
    await git(['add', '--', path]);
    await git(['commit', '--quiet', '-m', `capture: ${path}`]);
    await pushWithRetry({ git, fetch, branch, remoteRef }, path);
    return (await git(['rev-parse', 'HEAD'])).trim();
  }
  return { sync, commitAndPush };
}

export function createVault(options: VaultOptions): Vault {
  const { remoteUrl, dir } = options;
  const clone = createClone(options);

  async function capture(path: string, content: string): Promise<Captured> {
    if (!INBOX_PATH.test(path)) {
      throw new VaultError('refused', 'The path must be _inbox/YYYY-MM-DD-short-slug.md');
    }
    await clone.sync();
    const inbox = join(dir, '_inbox');
    if ((await exists(inbox)) && !(await lstat(inbox)).isDirectory()) {
      throw new VaultError('refused', '_inbox is not a folder in this vault');
    }
    if (await exists(join(dir, path))) {
      throw new VaultError('refused', `${path} already exists; it is never overwritten`);
    }
    await mkdir(inbox, { recursive: true });
    await atomicWrite(join(dir, path), content);
    const sha = await clone.commitAndPush(path);
    const url = commitUrl(remoteUrl, sha);
    return { path, sha, ...(url === undefined ? {} : { url }) };
  }

  // One capture at a time: two at once would race on the same clone.
  let last: Promise<unknown> = Promise.resolve();
  return {
    capture: (path, content) => {
      const next = last.then(() => capture(path, content));
      last = next.catch(() => undefined);
      return next;
    },
  };
}
