import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CodeInput, digitsOnly } from './CodeInput.tsx';
import { nextMode, ThreeWay } from './ThreeWay.tsx';

describe('digitsOnly', () => {
  it.each([
    ['12ab34567', '123456'],
    ['', ''],
    ['abc', ''],
    [' 4 2 ', '42'],
  ])('keeps at most six digits of "%s"', (input, expected) => {
    expect(digitsOnly(input)).toBe(expected);
  });
});

describe('CodeInput', () => {
  it('asks the phone for a one-time code and the number pad', () => {
    const markup = renderToStaticMarkup(
      createElement(CodeInput, { label: 'Code', value: '', onChange: () => undefined }),
    );
    expect(markup).toContain('inputMode="numeric"');
    expect(markup).toContain('autoComplete="one-time-code"');
    expect(markup).toContain('maxLength="6"');
  });
});

describe('nextMode', () => {
  it.each([
    ['off', 'ArrowRight', 'ltr', 'ask'],
    ['ask', 'ArrowLeft', 'ltr', 'off'],
    ['auto', 'ArrowRight', 'ltr', 'auto'],
    ['off', 'ArrowLeft', 'ltr', 'off'],
    ['off', 'ArrowLeft', 'rtl', 'ask'],
    ['ask', 'ArrowRight', 'rtl', 'off'],
    ['off', 'ArrowDown', 'rtl', 'ask'],
    ['ask', 'ArrowUp', 'ltr', 'off'],
    ['ask', 'Home', 'ltr', 'off'],
    ['ask', 'End', 'rtl', 'auto'],
  ] as const)('from %s, %s in %s goes to %s', (from, key, dir, to) => {
    expect(nextMode(from, key, dir)).toBe(to);
  });

  it('ignores other keys', () => {
    expect(nextMode('ask', 'a', 'ltr')).toBeUndefined();
  });
});

describe('ThreeWay', () => {
  const labels = { off: 'Off', ask: 'Ask', auto: 'Auto' };
  const render = (risk?: string) =>
    renderToStaticMarkup(
      createElement(ThreeWay, {
        label: 'Email',
        value: 'ask',
        labels,
        onChange: () => undefined,
        ...(risk === undefined ? {} : { risk }),
      }),
    );

  it('is a radio group with one tab stop on the chosen option', () => {
    const markup = render();
    expect(markup).toContain('role="radiogroup"');
    expect(markup.match(/role="radio"/g)).toHaveLength(3);
    expect(markup.match(/tabindex="0"/g)).toHaveLength(1);
    expect(markup).toMatch(
      /aria-checked="true"[^>]*tabindex="0"|tabindex="0"[^>]*aria-checked="true"/,
    );
  });

  it('shows the risk text and links it to the group', () => {
    const markup = render('Runs without asking');
    expect(markup).toContain('Runs without asking');
    expect(markup).toMatch(/aria-describedby="([^"]+)"/);
  });

  it('has no description without a risk', () => {
    expect(render()).not.toContain('aria-describedby');
  });
});
