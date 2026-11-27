import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { standing, type Standing } from './api.ts';
import { Button } from './components/Button.tsx';
import { SignIn } from './screens/SignIn.tsx';

const STATUS = {
  loading: 'app.loading',
  unknown: 'app.unreachable',
  in: 'app.empty',
  change: 'app.loading',
  out: 'app.loading',
} as const;

// One screen at a time, decided by what the server says about this browser's session.
export function App() {
  const { t } = useTranslation();
  const [where, setWhere] = useState<Standing | 'loading'>('loading');
  const refresh = () => {
    void standing().then(setWhere);
  };
  useEffect(refresh, []);
  if (where === 'out') return <SignIn onDone={setWhere} />;
  return (
    <main className="page">
      <h1>{t('app.name')}</h1>
      <p>{t(STATUS[where])}</p>
      {where === 'unknown' ? <Button onClick={refresh}>{t('app.retry')}</Button> : null}
    </main>
  );
}
