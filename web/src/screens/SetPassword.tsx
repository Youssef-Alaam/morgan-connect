import { useState, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { setPassword, signIn, standing, type Standing } from '../api.ts';
import { Button } from '../components/Button.tsx';
import { PasswordInput, TextInput } from '../components/TextInput.tsx';
import { tokenFromHash } from '../link.ts';
import { ErrorBanner, typed } from './ErrorBanner.tsx';

const MIN_LENGTH = 12;
const LINK_INVALID = 'link_invalid';

/** Read the token once and take it out of the address bar, so it is not left in history or a screenshot. */
function takeToken(): string {
  const token = tokenFromHash(window.location.hash);
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return token;
}

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
        <Button type="submit" disabled={token === '' || password.length < MIN_LENGTH}>
          {t('setPassword.submit')}
        </Button>
      </form>
    </main>
  );
}
