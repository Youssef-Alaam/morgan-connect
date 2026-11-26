import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const rawValue = /#[0-9a-f]{3,8}\b|\b(rgb|hsl)a?\(|-?\d*\.?\d+(px|rem|em)\b/i;
const physical =
  /\b(margin|padding|border|inset)-(left|right|top|bottom)\b|(^|[\s;{])(left|right|top|bottom)\s*:|text-align\s*:\s*(left|right)|\bfloat\s*:\s*(left|right)/i;

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? cssFiles(join(dir, e.name))
      : e.name.endsWith('.css')
        ? [join(dir, e.name)]
        : [],
  );
}

describe('stylesheets', () => {
  const files = cssFiles('web/src');

  it.each(['color: #fff', 'padding: 4px', 'gap: 1.5rem', 'color: rgb(0 0 0)'])(
    'detects the raw value "%s"',
    (sample) => {
      expect(rawValue.test(sample)).toBe(true);
    },
  );

  it.each(['margin-left: 0', 'padding-right: 1', 'left: 0', 'text-align: right', 'float: left'])(
    'detects the physical property "%s"',
    (sample) => {
      expect(physical.test(sample)).toBe(true);
    },
  );

  it.each(files)('%s uses tokens and logical properties only', (file) => {
    // @font-face blocks name font files, which is the one place raw values are fine.
    const css = readFileSync(file, 'utf8').replace(/@font-face\s*\{[^}]*\}/g, '');
    expect(css).not.toMatch(rawValue);
    expect(css).not.toMatch(physical);
  });
});
