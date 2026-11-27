import { useState, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { changePassword } from '../api.ts';
import { Button } from '../components/Button.tsx';
import { PasswordInput } from '../components/TextInput.tsx';
import { MIN_PASSWORD_LENGTH } from '../password.ts';
import { Checkbox } from '../components/Toggle.tsx';
import { ErrorBanner, typed } from './ErrorBanner.tsx';

interface ChangePasswordProps {
  onDone: () => void;
}

// Where a first or temporary password ends: choose your own, and accept the admin-read notice (D59).
export function ChangePassword({ onDone }: ChangePasswordProps) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string>();
  const ready = accepted && next.length >= MIN_PASSWORD_LENGTH;
  const toggle = { showLabel: t('signIn.show'), hideLabel: t('signIn.hide') };

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    setError(undefined);
    const answer = await changePassword(current, next, accepted);
    if (answer.ok) onDone();
    else setError(answer.error);
  };

  return (
    <main className="page screen">
      <h1>{t('change.title')}</h1>
      <p>{t('change.intro')}</p>
      <form className="screen-form" onSubmit={(event) => void submit(event)}>
        <ErrorBanner error={error} />
        <PasswordInput
          {...toggle}
          label={t('change.current')}
          autoComplete="current-password"
          value={current}
          onChange={typed(setCurrent)}
        />
        <PasswordInput
          {...toggle}
          label={t('change.next')}
          hint={t('change.nextHint')}
          autoComplete="new-password"
          value={next}
          onChange={typed(setNext)}
        />
        <Checkbox
          label={t('join.notice.admin_can_read')}
          checked={accepted}
          onChange={(event) => {
            setAccepted(event.target.checked);
          }}
        />
        <Button type="submit" disabled={!ready}>
          {t('change.submit')}
        </Button>
      </form>
    </main>
  );
}
