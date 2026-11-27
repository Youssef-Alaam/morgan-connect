import { useTranslation } from 'react-i18next';
import { Button } from '../components/Button.tsx';
import { Authenticator } from './Authenticator.tsx';
import { TopBar } from './TopBar.tsx';

interface SecurityProps {
  onBack: () => void;
  onSignedOut: () => void;
}

// The account's own sign-in protection. More than one way to sign in is added here, one section each.
export function Security({ onBack, onSignedOut }: SecurityProps) {
  const { t } = useTranslation();
  return (
    <main className="page screen">
      <TopBar onSignedOut={onSignedOut}>
        <Button variant="secondary" onClick={onBack}>
          {t('security.back')}
        </Button>
      </TopBar>
      <h2>{t('security.title')}</h2>
      <Authenticator />
    </main>
  );
}
