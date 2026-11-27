import { useTranslation } from 'react-i18next';
import { Button } from '../components/Button.tsx';
import { Dialog } from '../components/Dialog.tsx';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  /** `danger` (the default) for what cannot be taken back; `primary` for an action that only adds. */
  tone?: 'danger' | 'primary';
  onConfirm: () => void;
  onCancel: () => void;
}

// A question before something that cannot be undone from this page: Cancel (or Escape) leaves everything as it is.
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  tone = 'danger',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open title={title} closeLabel={t('users.cancel')} onClose={onCancel}>
      <p>{message}</p>
      <Button variant={tone} onClick={onConfirm}>
        {confirmLabel}
      </Button>
    </Dialog>
  );
}
