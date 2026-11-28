// A13: an install with only Pi must work. Closed engine SDKs are `optionalDependencies`; only the
// optional adapter folders may import them, so `npm ci --omit=optional` still builds and boots.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';

const SRC_DIR = 'src';
const ADAPTER_DIRS = ['src/engines/optional/'];

const SPECIFIER = [
  /\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]/g,
];

/** The package name of each bare import in a source text (`@a/b/c` gives `@a/b`). */
export function importedPackages(source) {
  const found = [];
  for (const pattern of SPECIFIER) {
    for (const match of source.matchAll(pattern)) {
      const spec = match[1];
      if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) continue;
      const parts = spec.split('/');
      const pkg = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
      found.push({ at: match.index, pkg });
    }
  }
  return found.sort((a, b) => a.at - b.at).map((entry) => entry.pkg);
}

export function isAdapterPath(name) {
  return ADAPTER_DIRS.some((dir) => name.startsWith(dir));
}

/** Every optional package imported by a file outside the adapter folders. */
export function checkOptionalImports(files, optionalNames) {
  if (optionalNames.length === 0) return [];
  const offences = [];
  for (const { name, source } of files) {
    if (isAdapterPath(name)) continue;
    for (const pkg of new Set(importedPackages(source))) {
      if (optionalNames.includes(pkg)) offences.push({ file: name, pkg });
    }
  }
  return offences;
}

function readSources(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.ts'))
    .map((name) => ({
      name: join(dir, name).split(sep).join('/'),
      source: readFileSync(join(dir, name), 'utf8'),
    }));
}

function main() {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  const optional = Object.keys(manifest.optionalDependencies ?? {});
  const offences = checkOptionalImports(readSources(SRC_DIR), optional);
  for (const { file, pkg } of offences) console.error(`${file} imports optional package ${pkg}`);
  if (offences.length > 0) {
    console.error(`Optional packages may only be imported under: ${ADAPTER_DIRS.join(', ')}`);
    process.exit(1);
  }
  console.log(`Optional imports OK (${String(optional.length)} optional packages).`);
}

if (process.argv[1]?.endsWith('check-optional-imports.mjs')) main();
