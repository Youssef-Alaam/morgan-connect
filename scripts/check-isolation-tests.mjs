// Isolation coverage (STANDARDS section 3): every table created by a migration must be
// mentioned by an isolation test. Minimal version: no migrations exist yet, so it passes.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = 'src/data/migrations';
const ISOLATION_DIR = 'test/integration';

export function findTables(sqlSources) {
  const tables = new Set();
  const pattern = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?\w+"?\.)?"?(\w+)"?/gi;
  for (const sql of sqlSources) {
    for (const match of sql.matchAll(pattern)) tables.add(match[1]);
  }
  return [...tables];
}

export function findUntestedTables(tables, testSources) {
  return tables.filter((table) => {
    const whole = new RegExp(`(?<!\\w)${table}(?!\\w)`);
    return !testSources.some((source) => whole.test(source));
  });
}

function readFilesWithSuffix(dir, suffix) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith(suffix))
    .map((name) => readFileSync(join(dir, name), 'utf8'));
}

function main() {
  const tables = findTables(readFilesWithSuffix(MIGRATIONS_DIR, '.sql'));
  const tests = readFilesWithSuffix(ISOLATION_DIR, 'isolation.test.ts');
  const untested = findUntestedTables(tables, tests);
  if (untested.length > 0) {
    console.error(`Tables without an isolation test: ${untested.join(', ')}`);
    process.exit(1);
  }
  console.log(`Isolation coverage OK (${tables.length} tables).`);
}

if (process.argv[1]?.endsWith('check-isolation-tests.mjs')) {
  main();
}
