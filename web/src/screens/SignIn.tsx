import { useState, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { secondFactor, signIn, standing, type Standing } from '../api.ts';
import { Button } from '../components/Button.tsx';
import { CodeInput } from '../components/CodeInput.tsx';
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

const challengeOf = (data: unknown): string | undefined =>
  typeof data === 'object' &&
  data !== null &&
  'challenge' in data &&
  typeof data.challenge === 'string'
    ? data.challenge
    : undefined;

interface CodeProps {
  code: string;
  setCode: (value: string) => void;
  onBack: () => void;
}

// The six-digit authenticator code, or (one switch away) a backup code, which is plain text.
function CodeStep({ code, setCode, onBack }: CodeProps) {
  const { t } = useTranslation();
  const [backup, setBackup] = useState(false);
  const flip = () => {
    setCode('');
    setBackup(!backup);
  };
  return (
    <>
      {backup ? (
        <TextInput
          label={t('signIn.backup')}
          hint={t('signIn.backupHint')}
          autoComplete="off"
          spellCheck={false}
          maxLength={32}
          value={code}
          onChange={typed(setCode)}
        />
      ) : (
        <CodeInput
          label={t('signIn.code')}
          hint={t('signIn.codeHint')}
          value={code}
          onChange={setCode}
        />
      )}
      <Button variant="secondary" onClick={flip}>
        {t(backup ? 'signIn.useApp' : 'signIn.useBackup')}
      </Button>
      <Button variant="secondary" onClick={onBack}>
        {t('signIn.back')}
      </Button>
    </>
  );
}

// Password first; a person with an authenticator gets a second screen for the code (or a backup code).
export function SignIn({ onDone }: SignInProps) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<string>();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const back = () => {
    setChallenge(undefined);
    setCode('');
    setError(undefined);
  };

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    const answer =
      challenge === undefined ? await signIn(email, password) : await secondFactor(challenge, code);
    if (!answer.ok) setError(answer.error);
    else if (challengeOf(answer.data) !== undefined) setChallenge(challengeOf(answer.data));
    else onDone(await standing());
    setBusy(false);
  };

  return (
    <main className="page screen">
      <h1>{t('signIn.title')}</h1>
      <form className="screen-form" onSubmit={(event) => void submit(event)}>
        <ErrorBanner error={error} />
        {challenge === undefined ? (
          <PasswordStep {...{ email, password, setEmail, setPassword }} />
        ) : (
          <CodeStep {...{ code, setCode }} onBack={back} />
        )}
        <Button type="submit" disabled={busy}>
          {t(challenge === undefined ? 'signIn.submit' : 'signIn.verify')}
        </Button>
      </form>
    </main>
  );
}
