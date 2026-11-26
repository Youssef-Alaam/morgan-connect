import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/Button.tsx';
import { Dialog } from '../components/Dialog.tsx';
import { Toast, ToastRegion } from '../components/Toast.tsx';
import { GallerySection } from './GallerySection.tsx';

const DIALOG = 'dialog';
const TOAST = 'toast';
const noop = () => undefined;

export function DialogSection() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const close = () => {
    setOpen(false);
  };
  return (
    <GallerySection name={DIALOG} title={t('gallery.dialog.title')}>
      <Button
        variant="secondary"
        onClick={() => {
          setOpen(true);
        }}
      >
        {t('gallery.dialog.open')}
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title={t('gallery.dialog.heading')}
        closeLabel={t('gallery.dialog.close')}
      >
        <p>{t('gallery.dialog.text')}</p>
        <div className="dialog-actions">
          <Button variant="secondary" onClick={close}>
            {t('gallery.dialog.cancel')}
          </Button>
          <Button variant="danger" onClick={close}>
            {t('gallery.dialog.confirm')}
          </Button>
        </div>
      </Dialog>
    </GallerySection>
  );
}

export function ToastSection() {
  const { t } = useTranslation();
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  return (
    <GallerySection name={TOAST} title={t('gallery.toast.title')}>
      <Toast dismissLabel={t('gallery.toast.dismiss')} onDismiss={noop}>
        {t('gallery.toast.example')}
      </Toast>
      <Button
        variant="secondary"
        onClick={() => {
          setToasts([...toasts, { id: toasts.length + 1, text: t('gallery.toast.saved') }]);
        }}
      >
        {t('gallery.toast.show')}
      </Button>
      <ToastRegion
        toasts={toasts}
        dismissLabel={t('gallery.toast.dismiss')}
        onDismiss={(id) => {
          setToasts(toasts.filter((toast) => toast.id !== id));
        }}
      />
    </GallerySection>
  );
}
