import { useTranslation } from 'react-i18next';

export function App() {
  const { t } = useTranslation();
  return (
    <main className="page">
      <h1>{t('app.name')}</h1>
      <p>{t('app.empty')}</p>
    </main>
  );
}
