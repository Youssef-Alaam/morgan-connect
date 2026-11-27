import type { ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Banner } from '../components/Banner.tsx';
import { errorKey } from '../errors.ts';

/** Nothing when there is no error; else the refusal in words. */
export function ErrorBanner({ error }: { error: string | undefined }) {
  const { t } = useTranslation();
  if (error === undefined) return null;
  return (
    <Banner tone="danger" label={t('errors.label')}>
      {t(errorKey(error))}
    </Banner>
  );
}

/** An input's change handler that hands the new text to a state setter. */
export function typed(set: (value: string) => void) {
  return (event: ChangeEvent<HTMLInputElement>) => {
    set(event.target.value);
  };
}
