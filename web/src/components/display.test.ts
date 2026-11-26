import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Badge } from './Badge.tsx';
import { Banner } from './Banner.tsx';
import { EmptyState } from './EmptyState.tsx';
import { Table } from './Table.tsx';

const render = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);

describe('Badge', () => {
  it.each(['neutral', 'danger'] as const)('has a %s look', (tone) => {
    expect(render(createElement(Badge, { tone }, 'x'))).toContain(`badge-${tone}`);
  });

  it('is neutral by default', () => {
    expect(render(createElement(Badge, null, 'x'))).toContain('badge-neutral');
  });
});

describe('Banner', () => {
  it('announces an info banner politely', () => {
    const markup = render(createElement(Banner, { tone: 'info', label: 'Note' }, 'Body'));
    expect(markup).toContain('role="status"');
    expect(markup).toContain('banner-info');
  });

  it.each(['warning', 'danger'] as const)('interrupts for a %s banner', (tone) => {
    expect(render(createElement(Banner, { tone, label: 'L' }, 'Body'))).toContain('role="alert"');
  });

  it('says what kind of banner it is in words, not only colour', () => {
    expect(render(createElement(Banner, { tone: 'warning', label: 'Careful' }, 'Body'))).toContain(
      'Careful',
    );
  });
});

describe('Table', () => {
  const markup = render(
    createElement(Table, {
      caption: 'People',
      columns: ['Name', 'Role'],
      rows: [
        ['Youssef', 'Owner'],
        ['Narimane', 'Member'],
      ],
    }),
  );

  it('has a caption and column headers', () => {
    expect(markup).toContain('<caption>People</caption>');
    expect(markup.match(/<th scope="col">/g)).toHaveLength(2);
  });

  it('has one body row per row', () => {
    expect(markup.match(/<tr>/g)).toHaveLength(3);
    expect(markup).toContain('<td>Narimane</td>');
  });
});

describe('EmptyState', () => {
  it('shows a title, a reason and an optional action', () => {
    const action = createElement('button', null, 'Start');
    const markup = render(createElement(EmptyState, { title: 'No chats', action }, 'Say hi.'));
    expect(markup).toContain('No chats');
    expect(markup).toContain('Say hi.');
    expect(markup).toContain('Start');
  });

  it('works without an action', () => {
    const markup = render(createElement(EmptyState, { title: 'No chats' }, 'Say hi.'));
    expect(markup).not.toContain('button');
  });
});
