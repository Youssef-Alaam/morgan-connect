import { useTranslation } from 'react-i18next';
import { ButtonSection } from './ButtonSection.tsx';
import { BadgeSection, BannerSection, EmptyStateSection, TableSection } from './DataSection.tsx';
import { DialogSection, ToastSection } from './OverlaySection.tsx';
import { CodeSection, ThreeWaySection } from './ControlSection.tsx';
import { ChoicesSection, InputsSection } from './FormSection.tsx';

// The component page (`/components` in the dev server): every component, one section each.
export function Gallery() {
  const { t } = useTranslation();
  return (
    <main className="page">
      <h1>{t('gallery.title')}</h1>
      <ButtonSection />
      <InputsSection />
      <ChoicesSection />
      <CodeSection />
      <ThreeWaySection />
      <BadgeSection />
      <BannerSection />
      <TableSection />
      <EmptyStateSection />
      <DialogSection />
      <ToastSection />
    </main>
  );
}
