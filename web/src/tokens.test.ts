import { describe, expect, it } from 'vitest';
import { buildCss, component, modes } from './tokens.ts';

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

// Body text needs 4.5:1; large text and UI parts need 3:1 (WCAG AA).
const pairs = [
  ['text', 'surface', 4.5],
  ['text', 'raised', 4.5],
  ['muted', 'surface', 4.5],
  ['muted', 'raised', 4.5],
  ['onAccent', 'accent', 4.5],
  ['brand', 'surface', 3],
  ['focus', 'surface', 3],
  ['focus', 'raised', 3],
  ['danger', 'surface', 3],
  ['danger', 'raised', 3],
  ['dangerText', 'surface', 4.5],
  ['dangerText', 'raised', 4.5],
  ['brand', 'raised', 3],
] as const;

describe.each(Object.keys(modes) as (keyof typeof modes)[])('%s mode', (mode) => {
  it.each(pairs)('%s on %s is at least %d:1', (fg, bg, min) => {
    expect(contrast(modes[mode][fg], modes[mode][bg])).toBeGreaterThanOrEqual(min);
  });
});

describe.each(Object.keys(modes) as (keyof typeof modes)[])('%s component borders', (mode) => {
  it.each(Object.entries(component).filter(([name]) => name.endsWith('-border')))(
    '%s is at least 3:1 on the surface',
    (_name, target) => {
      expect(contrast(modes[mode][target], modes[mode].surface)).toBeGreaterThanOrEqual(3);
    },
  );
});

describe('buildCss', () => {
  const css = buildCss();

  it('defines every semantic name in light and in dark', () => {
    expect(Object.keys(modes.dark)).toEqual(Object.keys(modes.light));
    for (const name of Object.keys(modes.light)) {
      expect(css).toContain(`--${name}:`);
    }
  });

  it('switches to the dark values with the system setting', () => {
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain('color-scheme: light dark');
  });
});
