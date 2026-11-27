import { useState, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { createAccount } from '../api.ts';
import { Button } from '../components/Button.tsx';
import { TextInput } from '../components/TextInput.tsx';
import { Copyable } from './Copyable.tsx';
import { ErrorBanner, typed } from './ErrorBanner.tsx';
import { limitOf } from './limit.ts';

const K = 'users.account';

interface FormProps {
  onMade: (temporaryPassword: string) => void;
  onError: (error: string | undefined) => void;
}

function AccountForm({ onMade, onError }: FormProps) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [limit, setLimit] = useState('');
  const create = (event: SyntheticEvent) => {
    event.preventDefault();
    onError(undefined);
    void createAccount(email, limitOf(limit)).then((answer) => {
      if (answer.ok) {
        setEmail('');
        onMade(answer.data.temporaryPassword);
      } else onError(answer.error);
    });
  };
  return (
    <form className="screen-form" onSubmit={create}>
      <TextInput
        label={t(`${K}.email`)}
        type="email"
        autoComplete="off"
        value={email}
        onChange={typed(setEmail)}
      />
      <TextInput
        label={t('users.invites.limit')}
        hint={t('users.invites.limitHint')}
        inputMode="decimal"
        value={limit}
        onChange={typed(setLimit)}
      />
      <Button type="submit">{t(`${K}.create`)}</Button>
    </form>
  );
}

interface NewAccountProps {
  /** Called after an account exists, so the people list can reload. */
  onCreated: () => void;
}

// An account the admin makes with a temporary password, shown once; the person must change it at first sign-in.
export function NewAccount({ onCreated }: NewAccountProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState<string>();
  const [error, setError] = useState<string>();
  return (
    <section aria-labelledby="account-title" className="screen-form">
      <h3 id="account-title">{t(`${K}.title`)}</h3>
      <ErrorBanner error={error} />
      <AccountForm
        onError={(next) => {
          setError(next);
          setPassword(undefined);
        }}
        onMade={(made) => {
          setPassword(made);
          onCreated();
        }}
      />
      {password === undefined ? null : (
        <Copyable
          label={t(`${K}.password`)}
          hint={t(`${K}.passwordHint`)}
          value={password}
          copyLabel={t(`${K}.copy`)}
          copiedLabel={t('users.invites.copied')}
        />
      )}
    </section>
  );
}
