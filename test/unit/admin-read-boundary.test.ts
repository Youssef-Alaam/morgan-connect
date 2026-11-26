import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { expect, it } from 'vitest';

// The admin read path is opened only by src/data/admin-read.ts. No other source file may mention
// the database functions (roles.ts grants them through the module's constant), so a new caller
// cannot slip in.
const ALLOWED = new Set(['src/data/admin-read.ts']);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name).split(sep).join('/');
    if (entry.isDirectory()) return sources(path);
    return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : [];
  });
}

it('names the admin read functions in no other source file', () => {
  const users = sources('src').filter(
    (file) =>
      !file.startsWith('src/data/migrations/') &&
      !ALLOWED.has(file) &&
      /admin_read_(gate|chat|usage)/.test(readFileSync(file, 'utf8')),
  );
  expect(users).toEqual([]);
});
