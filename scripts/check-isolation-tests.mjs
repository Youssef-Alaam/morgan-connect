// The fast early check; the catalog test (test/integration/isolation-catalog.test.ts) is the
// authority, since a regex cannot follow a renamed table or a name held in a constant.
// Isolation coverage (STANDARDS step 14): every user-data table created by a migration must be
// covered by an isolation test, i.e. a file ending in `isolation.test.ts` that calls
// `expectIsolated('<table>', ...)`, the shared assertion that user A cannot read or write user B's
// rows. A table that is only named in a test, with no such call, is not covered. Tables on the
// install-wide exempt list (src/data/rls.ts) hold nobody's data and are skipped.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';

const MIGRATIONS_DIR = 'src/data/migrations';
const ISOLATION_DIR = 'test/integration';
const ISOLATION_SUFFIX = 'isolation.test.ts';

export function findTables(sources) {
  const tables = new Set();
  const patterns = [
    /create\s+(?:(?:global\s+|local\s+)?(?:temp(?:orary)?|unlogged)\s+)?table\s+(?:if\s+not\s+exists\s+)?(?:"?\w+"?\.)?"?(\w+)"?/gi,
    /createTable\(\s*['"](\w+)['"]/g,
  ];
  for (const source of sources) {
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) tables.add(match[1]);
    }
  }
  return [...tables];
}

/** True when this test source asserts isolation for the table (the call names the table). */
function covers(table, source) {
  return new RegExp(String.raw`expectIsolated\(\s*['"\x60]${table}['"\x60]`).test(source);
}

/** The first test file that covers each table, or undefined. Tests are `{ name, source }`. */
export function coverage(tables, tests) {
  return tables.map((table) => ({
    table,
    file: tests.find((test) => covers(table, test.source))?.name,
  }));
}

export function findUntestedTables(tables, testSources) {
  const tests = testSources.map((source, i) => ({ name: String(i), source }));
  return coverage(tables, tests)
    .filter((row) => row.file === undefined)
    .map((row) => row.table);
}

/** Every user-data table with its covering test; `missing` are the ones with none. */
export function checkIsolation({ migrations, tests, exempt }) {
  const tables = findTables(migrations).filter((table) => !exempt.includes(table));
  const rows = coverage(tables, tests);
  return { rows, missing: rows.filter((row) => row.file === undefined).map((row) => row.table) };
}

function readFilesWith(dir, suffixes) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((name) => suffixes.some((suffix) => name.endsWith(suffix)))
    .map((name) => ({
      name: join(dir, name).split(sep).join('/'),
      source: readFileSync(join(dir, name), 'utf8'),
    }));
}

async function main() {
  const { RLS_EXEMPT_TABLES } = await import('../src/data/rls.ts');
  const { rows, missing } = checkIsolation({
    migrations: readFilesWith(MIGRATIONS_DIR, ['.sql', '.ts']).map((file) => file.source),
    tests: readFilesWith(ISOLATION_DIR, [ISOLATION_SUFFIX]),
    exempt: RLS_EXEMPT_TABLES,
  });
  for (const row of rows) console.log(`${row.table.padEnd(22)} ${row.file ?? 'NO ISOLATION TEST'}`);
  if (missing.length > 0) {
    console.error(`Tables without an isolation test: ${missing.join(', ')}`);
    process.exit(1);
  }
  console.log(`Isolation coverage OK (${rows.length} user-data tables).`);
}

if (process.argv[1]?.endsWith('check-isolation-tests.mjs')) {
  await main();
}
