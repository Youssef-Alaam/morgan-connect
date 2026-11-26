import type { ReactNode } from 'react';

interface BannerProps {
  tone: 'info' | 'warning' | 'danger';
  // The kind in words, so the tone never depends on colour alone.
  label: string;
  children: ReactNode;
}

export function Banner({ tone, label, children }: BannerProps) {
  return (
    <div role={tone === 'info' ? 'status' : 'alert'} className={`banner banner-${tone}`}>
      <strong>{label}</strong>
      <span>{children}</span>
    </div>
  );
}
