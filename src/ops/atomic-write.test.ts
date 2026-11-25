import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { atomicWrite, nodeFs, type AtomicFs } from './atomic-write.js';

let dir: string;
let target: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'atomic-write-'));
  target = join(dir, 'note.txt');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const crashingRename: AtomicFs['rename'] = () => Promise.reject(new Error('simulated crash'));

it('writes the temp file in the same directory, then renames it over the target', async () => {
  const seen: string[] = [];
  const fs: AtomicFs = {
    ...nodeFs,
    rename: (from, to) => {
      seen.push(from);
      return nodeFs.rename(from, to);
    },
  };
  await atomicWrite(target, 'new', fs);
  expect(await readFile(target, 'utf8')).toBe('new');
  expect(seen).toHaveLength(1);
  expect(dirname(seen[0] ?? '')).toBe(dir);
  expect(await readdir(dir)).toEqual(['note.txt']);
});

it('leaves the old file intact when the rename never happens', async () => {
  await atomicWrite(target, 'old');
  const crashed: AtomicFs = { ...nodeFs, rename: crashingRename, rm: () => Promise.resolve() };
  await expect(atomicWrite(target, 'new', crashed)).rejects.toThrow('simulated crash');
  expect(await readFile(target, 'utf8')).toBe('old');
  // Only the stray temp file is left over; the target itself is never partial.
  expect((await readdir(dir)).filter((name) => name !== 'note.txt')).toHaveLength(1);
});

it('creates no target and cleans up its temp file when the first write fails to rename', async () => {
  await expect(atomicWrite(target, 'new', { ...nodeFs, rename: crashingRename })).rejects.toThrow(
    'simulated crash',
  );
  expect(await readdir(dir)).toEqual([]);
});

function lockedRename(failures: number, code: string): { fs: AtomicFs; calls: () => number } {
  let calls = 0;
  const rename: AtomicFs['rename'] = (from, to) => {
    calls += 1;
    if (calls <= failures) return Promise.reject(Object.assign(new Error('locked'), { code }));
    return nodeFs.rename(from, to);
  };
  return { fs: { ...nodeFs, rename, sleep: () => Promise.resolve() }, calls: () => calls };
}

it('retries a locked rename and then succeeds', async () => {
  const { fs, calls } = lockedRename(3, 'EBUSY');
  await atomicWrite(target, 'new', fs);
  expect(await readFile(target, 'utf8')).toBe('new');
  expect(calls()).toBe(4);
});

it('gives up after three retries and leaves the old file', async () => {
  await atomicWrite(target, 'old');
  const { fs, calls } = lockedRename(99, 'EPERM');
  await expect(atomicWrite(target, 'new', fs)).rejects.toThrow('locked');
  expect(calls()).toBe(4);
  expect(await readFile(target, 'utf8')).toBe('old');
});

it('does not retry other errors', async () => {
  const { fs, calls } = lockedRename(99, 'ENOSPC');
  await expect(atomicWrite(target, 'new', fs)).rejects.toThrow('locked');
  expect(calls()).toBe(1);
});

it('flushes the directory after the rename', async () => {
  const synced: string[] = [];
  await atomicWrite(target, 'new', {
    ...nodeFs,
    syncDir: (d) => (synced.push(d), Promise.resolve()),
  });
  expect(synced).toEqual([dir]);
});
