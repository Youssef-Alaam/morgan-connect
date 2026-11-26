import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}

export function EmptyState({ title, action, children }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
