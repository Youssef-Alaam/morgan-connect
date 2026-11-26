import type { ReactNode } from 'react';

interface PageLayoutProps {
  navLabel: string;
  links: { href: string; label: string; current?: boolean }[];
  children: ReactNode;
}

// Side navigation beside the content. The page supplies its own <main>.
export function PageLayout({ navLabel, links, children }: PageLayoutProps) {
  return (
    <div className="layout">
      <nav aria-label={navLabel} className="layout-nav">
        <ul>
          {links.map(({ href, label, current }) => (
            <li key={href}>
              <a href={href} aria-current={current === true ? 'page' : undefined}>
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="layout-content">{children}</div>
    </div>
  );
}
