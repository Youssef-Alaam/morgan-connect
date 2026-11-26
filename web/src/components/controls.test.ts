import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Switch } from './Toggle.tsx';
import { Select } from './Select.tsx';
import { PasswordInput, TextInput } from './TextInput.tsx';

const render = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);

describe('TextInput', () => {
  it('ties its label to the input', () => {
    const markup = render(createElement(TextInput, { label: 'Name' }));
    const id = /for="([^"]+)"/.exec(markup)?.[1];
    expect(id).toBeDefined();
    expect(markup).toContain(`id="${id ?? ''}"`);
  });

  it('links a hint and an error to the input and marks it invalid', () => {
    const markup = render(createElement(TextInput, { label: 'Name', hint: 'Shown', error: 'Bad' }));
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toMatch(/aria-describedby="[^"]+ [^"]+"/);
    expect(markup).toContain('Bad');
  });
});

describe('PasswordInput', () => {
  it('starts hidden with a button that shows it', () => {
    const markup = render(
      createElement(PasswordInput, {
        label: 'Password',
        showLabel: 'Show',
        hideLabel: 'Hide',
        autoComplete: 'new-password',
      }),
    );
    expect(markup).toContain('type="password"');
    expect(markup).toContain('aria-pressed="false"');
    expect(markup).toContain('Show');
    for (const attribute of [
      'autoComplete="new-password"',
      'spellCheck="false"',
      'autoCapitalize="off"',
      'autoCorrect="off"',
    ]) {
      expect(markup).toContain(attribute);
    }
  });
});

describe('Select', () => {
  it('lists its options under a label', () => {
    const markup = render(
      createElement(Select, {
        label: 'Mode',
        options: [
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Beta' },
        ],
      }),
    );
    expect(markup).toContain('<option value="a">Alpha</option>');
    expect(markup).toContain('Mode');
  });
});

describe('Switch', () => {
  it.each([true, false])('switch reports checked=%s to assistive tech', (checked) => {
    const markup = render(
      createElement(Switch, { label: 'On', checked, onChange: () => undefined }),
    );
    expect(markup).toContain('role="switch"');
    expect(markup).toContain('<span>On</span></label>'); // the label wraps it, so its text is clickable
    expect(markup).toContain(`aria-checked="${String(checked)}"`);
  });
});
