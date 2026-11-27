import { useState, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { setPassword, signIn, standing, type Standing } from '../api.ts';
import { Button } from '../components/Button.tsx';
import { PasswordInput, TextInput } from '../components/TextInput.tsx';
import { takeToken } from '../link.ts';
import { MIN_PASSWORD_LENGTH } from '../password.ts';
import { ErrorBanner, typed } from './ErrorBanner.tsx';

const LINK_INVALID = 'link_invalid';

interface SetPasswordProps {
  onDone: (next: Standing) => void;
}

// The first-password link: the one-time token goes in the request body, then the new login is used to sign in.
export function SetPassword({ onDone }: SetPasswordProps) {
  const { t } = useTranslation();
  const [token] = useState(takeToken);
  const [email, setEmail] = useState('');
  const [password, setPasswordText] = useState('');
  const [error, setError] = useState<string>();

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    setError(undefined);
    const set = await setPassword(token, email, password);
    if (!set.ok) {
      setError(set.error);
      return;
    }
    // The link is spent. If signing in fails, the sign-in screen takes over; the token is never sent again.
    window.history.replaceState(null, '', '/');
    const signed = await signIn(email, password);
    onDone(signed.ok ? await standing() : 'out');
  };

  return (
    <main className="page screen">
      <h1>{t('setPassword.title')}</h1>
      <p>{t('setPassword.intro')}</p>
      <form className="screen-form" onSubmit={(event) => void submit(event)}>
        <ErrorBanner error={token === '' ? LINK_INVALID : error} />
        <TextInput
          label={t('signIn.email')}
          type="email"
          autoComplete="username"
          value={email}
          onChange={typed(setEmail)}
        />
        <PasswordInput
          label={t('change.next')}
          hint={t('change.nextHint')}
          autoComplete="new-password"
          showLabel={t('signIn.show')}
          hideLabel={t('signIn.hide')}
          value={password}
          onChange={typed(setPasswordText)}
        />
        <Button type="submit" disabled={token === '' || password.length < MIN_PASSWORD_LENGTH}>
          {t('setPassword.submit')}
        </Button>
      </form>
    </main>
  );
}
