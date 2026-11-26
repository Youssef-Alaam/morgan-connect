import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Button } from './Button.tsx';

const html = (props: Parameters<typeof Button>[0]) =>
  renderToStaticMarkup(createElement(Button, props));

describe('Button', () => {
  it('is a primary button that never submits a form by default', () => {
    const markup = html({ children: 'Save' });
    expect(markup).toContain('class="btn btn-primary"');
    expect(markup).toContain('type="button"');
  });

  it.each(['primary', 'secondary', 'danger'] as const)('has a %s look', (variant) => {
    expect(html({ variant, children: 'Go' })).toContain(`btn-${variant}`);
  });

  it('passes native attributes through', () => {
    const markup = html({ type: 'submit', disabled: true, children: 'Go' });
    expect(markup).toContain('type="submit"');
    expect(markup).toContain('disabled');
  });
});
