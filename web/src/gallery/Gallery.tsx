import { useTranslation } from 'react-i18next';
import { ButtonSection } from './ButtonSection.tsx';
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
    </main>
  );
}
