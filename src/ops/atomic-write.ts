import { open, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';

/** The file operations `atomicWrite` uses; tests replace them to simulate a crash. */
export interface AtomicFs {
  writeFile: (path: string, data: string | Uint8Array) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  rm: (path: string) => Promise<void>;
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
};

/**
 * Write `data` to `path` so a crash leaves either the old file or the new one, never half:
 * write a temp file in the same directory, flush it, then rename it over the target.
 */
export async function atomicWrite(
  path: string,
  data: string | Uint8Array,
  fs: AtomicFs = nodeFs,
): Promise<void> {
  const temp = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temp, data);
    await fs.rename(temp, path);
  } catch (error) {
    await fs.rm(temp);
    throw error;
  }
}
