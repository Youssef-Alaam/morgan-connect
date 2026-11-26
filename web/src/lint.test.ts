import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

async function ruleIds(code: string): Promise<string[]> {
  const [result] = await new ESLint().lintText(code, { filePath: 'web/src/App.tsx' });
  return (result?.messages ?? []).map((m) => m.ruleId ?? 'parse-error');
}

describe('web lint rules', () => {
  it.each([
    'const a = "0 4px";',
    'const a = "1px solid #fff";',
    'const a = "#fff !important";',
    'const a = "rgb(0 0 0)";',
    'const a = "50vh";',
    'const a = `${1} solid #fff`;',
    'const a = "font-family: serif";',
  ])('refuses the raw value in %s', async (code) => {
    expect(await ruleIds(code)).toContain('no-restricted-syntax');
  });

  it.each([
    'export function A() { return <p>Hello there</p>; }',
    'export function A() { return <input aria-label="Full name" />; }',
  ])('refuses the literal string in %s', async (code) => {
    expect(await ruleIds(code)).toContain('i18next/no-literal-string');
  });

  it('accepts a translated string', async () => {
    const code =
      'declare function t(key: string): string; export function A() { return <p>{t("app.name")}</p>; }';
    expect(await ruleIds(code)).toEqual([]);
  });
}, 60_000);
