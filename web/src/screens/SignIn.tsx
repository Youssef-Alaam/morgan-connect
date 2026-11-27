import { useState, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { signIn, standing, type Standing } from '../api.ts';
import { Button } from '../components/Button.tsx';
import { PasswordInput, TextInput } from '../components/TextInput.tsx';
import { ErrorBanner, typed } from './ErrorBanner.tsx';

interface SignInProps {
  onDone: (next: Standing) => void;
}

interface Fields {
  email: string;
  password: string;
  setEmail: (value: string) => void;
  setPassword: (value: string) => void;
}

function PasswordStep({ email, password, setEmail, setPassword }: Fields) {
  const { t } = useTranslation();
  return (
    <>
      <TextInput
        label={t('signIn.email')}
        type="email"
        autoComplete="username"
        value={email}
        onChange={typed(setEmail)}
      />
      <PasswordInput
        label={t('signIn.password')}
        autoComplete="current-password"
        showLabel={t('signIn.show')}
        hideLabel={t('signIn.hide')}
        value={password}
        onChange={typed(setPassword)}
      />
    </>
  );
}

// Email and password; the second step for people with an authenticator comes in the next PR.
export function SignIn({ onDone }: SignInProps) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    const answer = await signIn(email, password);
    if (!answer.ok) setError(answer.error);
    else onDone(await standing());
    setBusy(false);
  };

  return (
    <main className="page screen">
      <h1>{t('signIn.title')}</h1>
      <form className="screen-form" onSubmit={(event) => void submit(event)}>
        <ErrorBanner error={error} />
        <PasswordStep {...{ email, password, setEmail, setPassword }} />
        <Button type="submit" disabled={busy}>
          {t('signIn.submit')}
        </Button>
      </form>
    </main>
  );
}
