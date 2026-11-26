import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Badge } from './Badge.tsx';
import { Banner } from './Banner.tsx';
import { EmptyState } from './EmptyState.tsx';
import { Table } from './Table.tsx';

const el = <P extends { children: ReactNode }>(
  component: (props: P) => ReactNode,
  props: Omit<P, 'children'>,
  children: ReactNode,
) => createElement(component, { ...props, children } as P);

const render = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);

describe('Badge', () => {
  it.each(['neutral', 'danger'] as const)('has a %s look', (tone) => {
    expect(render(el(Badge, { tone }, 'x'))).toContain(`badge-${tone}`);
  });

  it('is neutral by default', () => {
    expect(render(el(Badge, {}, 'x'))).toContain('badge-neutral');
  });
});

describe('Banner', () => {
  it('announces an info banner politely', () => {
    const markup = render(el(Banner, { tone: 'info', label: 'Note' }, 'Body'));
    expect(markup).toContain('role="status"');
    expect(markup).toContain('banner-info');
  });

  it.each(['warning', 'danger'] as const)('interrupts for a %s banner', (tone) => {
    expect(render(el(Banner, { tone, label: 'L' }, 'Body'))).toContain('role="alert"');
  });

  it('says what kind of banner it is in words, not only colour', () => {
    expect(render(el(Banner, { tone: 'warning', label: 'Careful' }, 'Body'))).toContain('Careful');
  });
});

describe('Table', () => {
  const markup = render(
    createElement(Table, {
      caption: 'People',
      columns: ['Name', 'Role'],
      rows: [
        { key: 'y', cells: ['Youssef', 'Owner'] },
        { key: 'n', cells: ['Narimane', 'Member'] },
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
    const markup = render(el(EmptyState, { title: 'No chats', action }, 'Say hi.'));
    expect(markup).toContain('No chats');
    expect(markup).toContain('Say hi.');
    expect(markup).toContain('Start');
  });

  it('works without an action', () => {
    const markup = render(el(EmptyState, { title: 'No chats' }, 'Say hi.'));
    expect(markup).not.toContain('button');
  });
});
