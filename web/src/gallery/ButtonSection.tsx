import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/Button.tsx';
import { GallerySection } from './GallerySection.tsx';

const NAME = 'button';

export function ButtonSection() {
  const { t } = useTranslation();
  const [presses, setPresses] = useState(0);
  return (
    <GallerySection name={NAME} title={t('gallery.button.title')}>
      <div className="gallery-row">
        <Button
          onClick={() => {
            setPresses(presses + 1);
          }}
        >
          {t('gallery.button.press')}
        </Button>
        <Button variant="secondary">{t('gallery.button.secondary')}</Button>
        <Button variant="danger">{t('gallery.button.danger')}</Button>
        <Button disabled>{t('gallery.button.disabled')}</Button>
      </div>
      <p role="status">{t('gallery.button.pressed', { times: presses })}</p>
    </GallerySection>
  );
}
