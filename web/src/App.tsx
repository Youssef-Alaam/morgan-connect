import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { standing, type Standing } from './api.ts';
import { Button } from './components/Button.tsx';
import { ChangePassword } from './screens/ChangePassword.tsx';
import { Chat } from './screens/Chat.tsx';
import { SetPassword } from './screens/SetPassword.tsx';
import { SignIn } from './screens/SignIn.tsx';

const STATUS = {
  loading: 'app.loading',
  unknown: 'app.unreachable',
  in: 'app.loading',
  change: 'app.loading',
  out: 'app.loading',
  first: 'app.loading',
} as const;

// One screen at a time, decided by what the server says about this browser's session.
export function App() {
  const { t } = useTranslation();
  const [where, setWhere] = useState<Standing | 'loading' | 'first'>(() =>
    window.location.pathname === '/set-password' ? 'first' : 'loading',
  );
  const refresh = () => {
    void standing().then(setWhere);
  };
  useEffect(() => {
    if (where === 'loading') refresh();
  }, []);
  const signedOut = useCallback(() => {
    setWhere('out');
  }, []);
  if (where === 'first') return <SetPassword onDone={setWhere} />;
  if (where === 'out') return <SignIn onDone={setWhere} />;
  if (where === 'change') return <ChangePassword onDone={refresh} />;
  if (where === 'in') return <Chat onSignedOut={signedOut} />;
  return (
    <main className="page">
      <h1>{t('app.name')}</h1>
      <p>{t(STATUS[where])}</p>
      {where === 'unknown' ? <Button onClick={refresh}>{t('app.retry')}</Button> : null}
    </main>
  );
}
