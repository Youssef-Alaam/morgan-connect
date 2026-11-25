import { randomUUID } from 'node:crypto';
import { open, rename, rm } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { basename, dirname, join } from 'node:path';

/** The file operations `atomicWrite` uses; tests replace them to simulate a crash. */
export interface AtomicFs {
  writeFile: (path: string, data: string | Uint8Array) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  rm: (path: string) => Promise<void>;
  /** Flush a directory entry to disk. Does nothing on Windows, which cannot open directories. */
  syncDir: (dir: string) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
}

export const nodeFs: AtomicFs = {
  writeFile: async (path, data) => {
    const handle = await open(path, 'wx');
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
  rename,
  rm: (path) => rm(path, { force: true }),
  syncDir: async (dir) => {
    if (process.platform === 'win32') return;
    const handle = await open(dir, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
  sleep: (ms) => sleep(ms),
};

const RETRYABLE_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RENAME_RETRIES = 3;

function isRetryable(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    RETRYABLE_CODES.has(error.code)
  );
}

/** Windows briefly locks files (antivirus, indexers), so retry a locked rename a few times. */
async function renameWithRetry(fs: AtomicFs, from: string, to: string): Promise<void> {
  for (let retry = 0; ; retry++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (error) {
      if (retry >= RENAME_RETRIES || !isRetryable(error)) throw error;
      await fs.sleep(20 * (retry + 1));
    }
  }
}

/**
 * Write `data` to `path` so a crash leaves either the old file or the new one, never half:
 * write a temp file in the same directory, flush it, rename it over the target, then flush
 * the directory so the rename itself survives a power cut.
 */
export async function atomicWrite(
  path: string,
  data: string | Uint8Array,
  fs: AtomicFs = nodeFs,
): Promise<void> {
  const temp = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temp, data);
    await renameWithRetry(fs, temp, path);
  } catch (error) {
    await fs.rm(temp);
    throw error;
  }
  await fs.syncDir(dirname(path));
}
