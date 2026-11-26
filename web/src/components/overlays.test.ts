import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Dialog } from './Dialog.tsx';
import { Toast, ToastRegion } from './Toast.tsx';

const render = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);

describe('Dialog', () => {
  const markup = render(
    createElement(Dialog, {
      open: false,
      onClose: () => undefined,
      title: 'Delete this chat?',
      children: 'It cannot be undone.',
    }),
  );

  it('is a dialog named by its title', () => {
    const labelled = /aria-labelledby="([^"]+)"/.exec(markup)?.[1];
    expect(labelled).toBeDefined();
    expect(markup).toContain(`<h2 id="${labelled ?? ''}">Delete this chat?</h2>`);
  });

  it('starts closed and holds its content', () => {
    expect(markup).not.toContain(' open');
    expect(markup).toContain('It cannot be undone.');
  });
});

describe('Toast', () => {
  it('shows its message with a dismiss button', () => {
    const markup = render(
      createElement(Toast, {
        dismissLabel: 'Dismiss',
        onDismiss: () => undefined,
        children: 'Saved',
      }),
    );
    expect(markup).toContain('Saved');
    expect(markup).toContain('>Dismiss</button>');
  });

  it('keeps its toasts in a polite live region', () => {
    const markup = render(
      createElement(ToastRegion, {
        toasts: [
          { id: 1, text: 'One' },
          { id: 2, text: 'Two' },
        ],
        dismissLabel: 'Dismiss',
        onDismiss: () => undefined,
      }),
    );
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('One');
    expect(markup).toContain('Two');
  });

  it('keeps the live region in the page when there are no toasts', () => {
    const markup = render(
      createElement(ToastRegion, { toasts: [], dismissLabel: 'x', onDismiss: () => undefined }),
    );
    expect(markup).toContain('aria-live="polite"');
  });
});
