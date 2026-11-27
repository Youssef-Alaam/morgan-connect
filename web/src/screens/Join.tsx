import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { join, standing, type Standing } from '../api.ts';
import { Button } from '../components/Button.tsx';
import { PasswordInput, TextInput } from '../components/TextInput.tsx';
import { Checkbox } from '../components/Toggle.tsx';
import { takeToken } from '../link.ts';
import { MIN_PASSWORD_LENGTH } from '../password.ts';
import { ErrorBanner, typed } from './ErrorBanner.tsx';

const LINK_INVALID = 'link_invalid';

interface JoinProps {
  onDone: (next: Standing) => void;
}

/** Sends the join request; on success the person is signed in, so the screen hands over to the server's word on where they stand. */
function useJoin(token: string, onDone: (next: Standing) => void) {
  const [error, setError] = useState<string>();
  const submit = async (login: { email: string; password: string; accepted: boolean }) => {
    setError(undefined);
    const answer = await join(token, login.email, login.password, login.accepted);
    if (!answer.ok) {
      setError(answer.error);
      return;
    }
    window.history.replaceState(null, '', '/');
    onDone(await standing());
  };
  return { error, submit };
}

// The invite link (`/join#token=...`): the one-time token goes in the request body, with the new login
// and the notice that the admin can read chats (D59). The answer already signs the person in.
export function Join({ onDone }: JoinProps) {
  const { t } = useTranslation();
  const [token] = useState(takeToken);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accepted, setAccepted] = useState(false);
  const { error, submit } = useJoin(token, onDone);
  const ready = token !== '' && accepted && password.length >= MIN_PASSWORD_LENGTH;

  return (
    <main className="page screen">
      <h1>{t('join.title')}</h1>
      <p>{t('join.intro')}</p>
      <form
        className="screen-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit({ email, password, accepted });
        }}
      >
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
          onChange={typed(setPassword)}
        />
        <Checkbox
          label={t('join.notice.admin_can_read')}
          checked={accepted}
          onChange={(event) => {
            setAccepted(event.target.checked);
          }}
        />
        <Button type="submit" disabled={!ready}>
          {t('join.submit')}
        </Button>
      </form>
    </main>
  );
}
