import type { ReactNode } from 'react';

interface GallerySectionProps {
  name: string;
  title: string;
  children: ReactNode;
}

// One block of the component page. `data-gallery` is what the screenshot tests walk.
export function GallerySection({ name, title, children }: GallerySectionProps) {
  const heading = `gallery-${name}`;
  return (
    <section className="gallery-section" data-gallery={name} aria-labelledby={heading}>
      <h2 id={heading}>{title}</h2>
      {children}
    </section>
  );
}
