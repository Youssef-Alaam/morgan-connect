import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChatBubble } from './ChatBubble.tsx';
import { Composer, shouldSend } from './Composer.tsx';

const render = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);
const noop = () => undefined;

describe('shouldSend', () => {
  it.each([
    ['Enter', false, false, true],
    ['Enter', true, false, false],
    ['Enter', false, true, false],
    ['a', false, false, false],
  ])('%s with shift=%s while composing=%s sends: %s', (key, shift, composing, expected) => {
    expect(shouldSend(key, shift, composing)).toBe(expected);
  });
});

describe('Composer', () => {
  const markup = render(
    createElement(Composer, { label: 'Message', sendLabel: 'Send', onSend: noop }),
  );

  it('has a named text area and a send button that submits', () => {
    expect(markup).toContain('<textarea');
    expect(markup).toContain('aria-label="Message"');
    expect(markup).toMatch(/<button[^>]*type="submit"[^>]*>Send<\/button>/);
  });
});

describe('ChatBubble', () => {
  it.each(['user', 'morgan'] as const)('marks a %s bubble', (from) => {
    const markup = render(
      createElement(ChatBubble, { from, author: 'Name', children: 'Hello' as ReactNode }),
    );
    expect(markup).toContain(`bubble-${from}`);
    expect(markup).toContain('Name');
    expect(markup).toContain('Hello');
  });
});
