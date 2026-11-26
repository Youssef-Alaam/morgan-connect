import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDb, migrateToLatest, type Db } from '../../src/data/index.js';
import { createApprovals, createGate } from '../../src/policy/index.js';
import { linkChats } from '../helpers/link-chats.js';
import { startPostgres, type TestPostgres } from '../helpers/postgres.js';

const CALLER = { channel: 'fake', chatId: 'owner-chat' };
const PATH = '_inbox/2026-11-26-idea.md';
let postgres: TestPostgres;
let db: Db;
let root: string;
let remote: string;

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t', ...args], {
    cwd,
    encoding: 'utf8',
  });

beforeAll(async () => {
  postgres = await startPostgres();
  db = createDb(postgres.url);
  await migrateToLatest(db);
  await linkChats(db, ['owner-chat']);
  root = mkdtempSync(join(tmpdir(), 'vault-int-'));
  remote = join(root, 'remote.git');
  git(root, 'init', '--quiet', '--bare', '-b', 'main', remote);
  const seed = join(root, 'seed');
  git(root, 'clone', '--quiet', remote, seed);
  git(seed, 'checkout', '-q', '-b', 'main');
  git(seed, 'commit', '--quiet', '--allow-empty', '-m', 'init');
  git(seed, 'push', '--quiet', 'origin', 'main');
}, 180_000);

afterAll(async () => {
  await db.destroy();
  await postgres.stop();
  rmSync(root, { recursive: true, force: true });
});

function gateWith(decision: 'approved' | 'denied') {
  const shown: string[] = [];
  const approvals = createApprovals({
    db,
    ttlMs: 60_000,
    prompt: ({ id, text }) => {
      shown.push(text);
      void approvals.decide(id, decision, CALLER);
      return Promise.resolve();
    },
  });
  const vault = {
    remoteUrl: remote,
    token: 'not-a-real-token',
    branch: 'main',
    dir: join(root, 'c'),
  };
  const gate = createGate({ db, approvals, vault });
  const tool = gate.toolsFor(CALLER).find((t) => t.name === 'vault_capture');
  if (tool === undefined) throw new Error('vault_capture is not registered');
  return { tool, shown };
}

it('is not registered when no vault is configured', () => {
  const names = createGate({ db })
    .toolsFor(CALLER)
    .map((t) => t.name);
  expect(names).not.toContain('vault_capture');
});

it('shows the path and text, then writes one commit only after Approve', async () => {
  const { tool, shown } = gateWith('approved');
  await tool.run({ path: PATH, text: 'remember this' });
  expect(shown[0]).toContain(PATH);
  expect(shown[0]).toContain('remember this');
  expect(git(remote, 'log', '--format=%s', 'main').trim().split('\n')).toEqual([
    `capture: ${PATH}`,
    'init',
  ]);
  expect(git(remote, 'show', `main:${PATH}`)).toContain('remember this');
});

it('writes nothing when the owner denies', async () => {
  const { tool } = gateWith('denied');
  await tool.run({ path: '_inbox/2026-11-26-other.md', text: 'no' });
  expect(git(remote, 'log', '--format=%s', 'main').trim().split('\n')).toHaveLength(2);
});
