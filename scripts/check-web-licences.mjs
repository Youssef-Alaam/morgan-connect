// Licences for the web/ workspace (STANDARDS section 5). The root check cannot see web/
// dependencies, so this checks them by name; font files are checked against licences-allowed.json.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';

const FONT_FILE = /\.(woff2?|ttf|otf)$/i;

// "name@version" for every package in an `npm ls --json` tree, except the workspace itself.
export function packagesIn(tree, seen = new Set()) {
  for (const [name, node] of Object.entries(tree.dependencies ?? {})) {
    if (node.resolved?.startsWith('file:') !== true) seen.add(`${name}@${node.version}`);
    packagesIn(node, seen);
  }
  return seen;
}

// A font file passes when an allowlist entry covers its folder and the licence file is beside it.
export function fontsWithoutLicence(fontPaths, entries, fileExists) {
  return fontPaths.filter((path) => {
    const dir = dirname(path);
    const entry = entries.find((e) => e.dir === dir);
    return entry === undefined || !fileExists(join(dir, entry.licenceFile));
  });
}

function main() {
  const allow = /--onlyAllow "([^"]+)"/.exec(
    JSON.parse(readFileSync('package.json', 'utf8')).scripts.licences,
  )?.[1];
  const ls = execFileSync('npm', ['ls', '-w', 'web', '--omit=dev', '--all', '--json'], {
    encoding: 'utf8',
    shell: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  const packages = [...packagesIn(JSON.parse(ls))].join(';');
  const bin = 'node_modules/license-checker-rseidelsohn/bin/license-checker-rseidelsohn.js';
  execFileSync(process.execPath, [bin, '--includePackages', packages, '--onlyAllow', allow ?? ''], {
    stdio: 'inherit',
  });
  const { fonts } = JSON.parse(readFileSync('licences-allowed.json', 'utf8'));
  const files = readdirSync('web/public/fonts', { recursive: true, encoding: 'utf8' })
    .filter((name) => FONT_FILE.test(name))
    .map((name) => join('web/public/fonts', name).replaceAll(sep, '/'));
  const bad = fontsWithoutLicence(files, fonts, existsSync);
  if (bad.length > 0) {
    console.error(`Font files without a listed licence file beside them: ${bad.join(', ')}`);
    process.exit(1);
  }
  console.log(`Web licences OK (${files.length} font files).`);
}

if (process.argv[1]?.endsWith('check-web-licences.mjs')) main();
