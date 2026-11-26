import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ApprovalCard } from './ApprovalCard.tsx';
import { PageLayout } from './PageLayout.tsx';

const render = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);
const noop = () => undefined;

describe('ApprovalCard', () => {
  const base = {
    title: 'Send this email?',
    approveLabel: 'Approve',
    denyLabel: 'Deny',
    onApprove: noop,
    onDeny: noop,
    children: 'To: Narimane',
  };

  it('asks with Approve and Deny while undecided', () => {
    const markup = render(createElement(ApprovalCard, base));
    expect(markup).toContain('>Approve</button>');
    expect(markup).toContain('>Deny</button>');
    expect(markup).toContain('To: Narimane');
  });

  it('shows the outcome instead of the buttons once decided', () => {
    const markup = render(createElement(ApprovalCard, { ...base, outcome: 'Approved' }));
    expect(markup).toContain('Approved');
    expect(markup).not.toContain('<button');
  });
});

describe('PageLayout', () => {
  const markup = render(
    createElement(PageLayout, {
      navLabel: 'Main',
      links: [
        { href: '#chat', label: 'Chat', current: true },
        { href: '#users', label: 'Users' },
      ],
      children: 'Content',
    }),
  );

  it('has a named navigation and the content beside it', () => {
    expect(markup).toContain('<nav aria-label="Main"');
    expect(markup).toContain('Content');
  });

  it('marks only the current page', () => {
    expect(markup.match(/aria-current="page"/g)).toHaveLength(1);
  });
});
