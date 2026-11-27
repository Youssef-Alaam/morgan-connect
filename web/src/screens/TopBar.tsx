import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { signOut } from '../api.ts';
import { Button } from '../components/Button.tsx';
import { ErrorBanner } from './ErrorBanner.tsx';

interface TopBarProps {
  onSignedOut: () => void;
  /** Buttons shown beside Sign out. */
  children?: ReactNode;
}

// The name, and the buttons every signed-in screen has. A session the server already ended counts as signed out.
export function TopBar({ onSignedOut, children }: TopBarProps) {
  const { t } = useTranslation();
  const [error, setError] = useState<string>();
  const out = () => {
    setError(undefined);
    void signOut().then((answer) => {
      if (answer.ok || answer.status === 401) onSignedOut();
      else setError(answer.error);
    });
  };
  return (
    <>
      <div className="page-bar">
        <h1>{t('app.name')}</h1>
        <div className="page-bar-actions">
          {children}
          <Button variant="secondary" onClick={out}>
            {t('app.signOut')}
          </Button>
        </div>
      </div>
      <ErrorBanner error={error} />
    </>
  );
}
