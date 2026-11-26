// The one file with raw colour, spacing and font values. Brand: docs/tickets/m2.md "Brand inputs".

const primitive = {
  charcoal: '#17181B',
  offWhite: '#ECE9E2',
  amber: '#F0B429',
  ochre: '#8A5A00',
  crimson: '#D0667A',
  crimsonDeep: '#B03A52',
  crimsonSoft: '#DC7487',
  paper: '#FAF8F4',
  ink: '#1B1C1F',
  stone: '#5E5B55',
  line: '#E2DED6',
  card: '#202226',
  lineDark: '#33363B',
  mutedDark: '#A3A098',
} as const;

// Layer 2: semantic names, per mode. Amber is for the mark and limit bars only (`brand`).
export const modes = {
  light: {
    surface: primitive.paper,
    raised: primitive.paper,
    text: primitive.ink,
    muted: primitive.stone,
    border: primitive.line,
    accent: primitive.ink,
    onAccent: primitive.paper,
    brand: primitive.ochre,
    danger: primitive.crimson,
    dangerText: primitive.crimsonDeep,
    focus: primitive.ochre,
  },
  dark: {
    surface: primitive.charcoal,
    raised: primitive.card,
    text: primitive.offWhite,
    muted: primitive.mutedDark,
    border: primitive.lineDark,
    accent: primitive.offWhite,
    onAccent: primitive.charcoal,
    brand: primitive.amber,
    danger: primitive.crimson,
    dangerText: primitive.crimsonSoft,
    focus: primitive.amber,
  },
} as const;

const scale = {
  'space-1': '0.25rem',
  'space-2': '0.5rem',
  'space-3': '1rem',
  'space-4': '1.5rem',
  'space-5': '3rem',
  radius: '0.5rem',
  'border-width': '1px',
  'font-size-sm': '0.875rem',
  'font-size-md': '1rem',
  'font-size-lg': '1.25rem',
  target: '2.75rem',
  'field-width': '16rem',
  'switch-width': '3rem',
  'switch-height': '1.75rem',
  'switch-thumb': '1.25rem',
  'opacity-disabled': '0.5',
  'opacity-scrim': '0.5',
  'dialog-width': '28rem',
  'font-sans': "'Space Grotesk', system-ui, -apple-system, 'Segoe UI', sans-serif",
  'font-mono': "'Space Mono', ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
} as const;

// Layer 3: component tokens point at semantic names, never at raw values.
export const component = {
  'button-background': 'accent',
  'button-color': 'onAccent',
  'button-danger-background': 'dangerText',
  'input-border': 'muted',
  'card-background': 'raised',
  'card-border': 'muted',
} as const;

const declarations = (values: Record<string, string>, indent: string): string =>
  Object.entries(values)
    .map(([name, value]) => `${indent}--${name}: ${value};`)
    .join('\n');

export function buildCss(): string {
  const links = Object.fromEntries(
    Object.entries(component).map(([name, target]) => [name, `var(--${target})`]),
  );
  const light = declarations({ ...scale, ...modes.light, ...links }, '  ');
  const dark = declarations(modes.dark, '    ');
  return [
    `:root {\n  color-scheme: light dark;\n${light}\n}`,
    `@media (prefers-color-scheme: dark) {\n  :root {\n${dark}\n  }\n}`,
  ].join('\n');
}
