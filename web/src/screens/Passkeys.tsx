import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listPasskeys, removePasskey, type Passkey } from '../api.ts';
import { Button } from '../components/Button.tsx';
import { Table } from '../components/Table.tsx';
import { AddPasskey } from './AddPasskey.tsx';
import { ErrorBanner } from './ErrorBanner.tsx';

const K = 'security.passkeys';

/** A date as year-month-day, the same wherever the person is. */
const day = (iso: string | null): string => (iso === null ? '' : iso.slice(0, 10));

interface ListProps {
  passkeys: Passkey[];
  onRemove: (passkey: Passkey) => void;
}

function PasskeyList({ passkeys, onRemove }: ListProps) {
  const { t } = useTranslation();
  if (passkeys.length === 0) return <p>{t(`${K}.none`)}</p>;
  return (
    <Table
      caption={t(`${K}.caption`)}
      columns={[t(`${K}.name`), t(`${K}.added`), t(`${K}.lastUsed`), t(`${K}.actions`)]}
      rows={passkeys.map((passkey) => ({
        key: passkey.id,
        cells: [
          passkey.name,
          day(passkey.createdAt),
          day(passkey.lastUsedAt),
          <Button
            key="remove"
            variant="secondary"
            aria-label={t(`${K}.removeNamed`, { name: passkey.name })}
            onClick={() => {
              onRemove(passkey);
            }}
          >
            {t(`${K}.remove`)}
          </Button>,
        ],
      }))}
    />
  );
}

// The passkeys on this account: what is there, and removing one (the server keeps the last way in).
export function Passkeys() {
  const { t } = useTranslation();
  const [passkeys, setPasskeys] = useState<Passkey[]>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [unavailable, setUnavailable] = useState(false);
  const load = useCallback(() => {
    void listPasskeys().then((answer) => {
      if (answer.ok) setPasskeys(answer.data);
      else setError(answer.error);
      setLoading(false);
    });
  }, []);
  useEffect(load, [load]);
  const remove = (passkey: Passkey) => {
    setError(undefined);
    void removePasskey(passkey.id).then((answer) => {
      if (answer.ok) load();
      else setError(answer.error);
    });
  };
  return (
    <section aria-labelledby="passkeys-title" className="screen-form">
      <h3 id="passkeys-title">{t(`${K}.title`)}</h3>
      <ErrorBanner error={error} />
      {loading ? <p>{t('app.loading')}</p> : null}
      {passkeys === undefined ? null : <PasskeyList passkeys={passkeys} onRemove={remove} />}
      {unavailable ? (
        <p>{t(`${K}.unavailable`)}</p>
      ) : (
        <AddPasskey
          onAdded={load}
          onUnavailable={() => {
            setUnavailable(true);
          }}
        />
      )}
    </section>
  );
}
