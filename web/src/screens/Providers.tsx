import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  listProviders,
  switchRoute,
  type Providers as ProvidersData,
  type ProviderRoute,
} from '../api.ts';
import { Badge } from '../components/Badge.tsx';
import { Button } from '../components/Button.tsx';
import { Table } from '../components/Table.tsx';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { ErrorBanner } from './ErrorBanner.tsx';
import { TopBar } from './TopBar.tsx';

const K = 'providers';

/** A moment as `year-month-day hour:minute`, UTC, the same wherever the admin is. */
const when = (iso: string): string => iso.slice(0, 16).replace('T', ' ');

interface RoutesProps {
  routes: ProviderRoute[];
  onSwitch: (route: ProviderRoute) => void;
}

function RouteTable({ routes, onSwitch }: RoutesProps) {
  const { t } = useTranslation();
  return (
    <Table
      caption={t(`${K}.routes.caption`)}
      columns={[
        t(`${K}.routes.provider`),
        t(`${K}.routes.model`),
        t(`${K}.routes.key`),
        t(`${K}.routes.status`),
        t(`${K}.routes.actions`),
      ]}
      rows={routes.map((route) => ({
        key: route.id,
        cells: [
          route.provider,
          route.model,
          <span key="key" dir="ltr">
            {route.keyLast4 === null ? t(`${K}.routes.noKey`) : `…${route.keyLast4}`}
          </span>,
          <Badge key="status" tone={route.enabled ? 'neutral' : 'danger'}>
            {t(`${K}.routes.${route.enabled ? 'on' : 'off'}`)}
          </Badge>,
          <Button
            key="switch"
            variant="secondary"
            aria-label={t(`${K}.routes.${route.enabled ? 'switchOffNamed' : 'switchOnNamed'}`, {
              provider: route.provider,
            })}
            onClick={() => {
              onSwitch(route);
            }}
          >
            {t(`${K}.routes.${route.enabled ? 'switchOff' : 'switchOn'}`)}
          </Button>,
        ],
      }))}
    />
  );
}

function ChannelTable({ channels }: { channels: ProvidersData['channels'] }) {
  const { t } = useTranslation();
  return (
    <Table
      caption={t(`${K}.channels.caption`)}
      columns={[t(`${K}.channels.channel`), t(`${K}.channels.status`), t(`${K}.channels.last`)]}
      rows={channels.map((channel) => ({
        key: channel.id,
        cells: [
          t(`${K}.channels.name.${channel.id}`, { defaultValue: channel.id }),
          t(`${K}.channels.${channel.configured ? 'configured' : 'notConfigured'}`),
          channel.lastMessageAt === null ? (
            t(`${K}.channels.never`)
          ) : (
            <span key="last" dir="ltr">
              {when(channel.lastMessageAt)}
            </span>
          ),
        ],
      }))}
    />
  );
}

/** The page's data, and the switch: asking first when a route goes off, since nobody can then chat on it. */
function useProviders() {
  const [data, setData] = useState<ProvidersData>();
  const [error, setError] = useState<string>();
  const [asking, setAsking] = useState<ProviderRoute>();
  const load = useCallback(() => {
    void listProviders().then((answer) => {
      if (answer.ok) setData(answer.data);
      else setError(answer.error);
    });
  }, []);
  useEffect(load, [load]);
  const apply = (route: ProviderRoute) => {
    setAsking(undefined);
    setError(undefined);
    void switchRoute(route.id, !route.enabled).then((done) => {
      if (!done.ok) setError(done.error);
      load();
    });
  };
  const onSwitch = (route: ProviderRoute) => {
    if (route.enabled) setAsking(route);
    else apply(route);
  };
  return {
    data,
    error,
    asking,
    apply,
    onSwitch,
    cancel: () => {
      setAsking(undefined);
    },
  };
}

interface ProvidersProps {
  onBack: () => void;
  onSignedOut: () => void;
}

// The admin's page for engines and channels: each configured route with its key hint and switch, each channel with its last message.
export function Providers({ onBack, onSignedOut }: ProvidersProps) {
  const { t } = useTranslation();
  const { data, error, asking, apply, onSwitch, cancel } = useProviders();
  return (
    <main className="page screen screen-wide">
      <TopBar onSignedOut={onSignedOut}>
        <Button variant="secondary" onClick={onBack}>
          {t(`${K}.back`)}
        </Button>
      </TopBar>
      <h2>{t(`${K}.title`)}</h2>
      <ErrorBanner error={error} />
      {data === undefined ? (
        error === undefined ? (
          <p>{t('app.loading')}</p>
        ) : null
      ) : (
        <>
          {data.routes.length === 0 ? (
            <p>{t(`${K}.routes.none`)}</p>
          ) : (
            <RouteTable routes={data.routes} onSwitch={onSwitch} />
          )}
          <div className="providers-channels">
            <ChannelTable channels={data.channels} />
          </div>
        </>
      )}
      {asking === undefined ? null : (
        <ConfirmDialog
          title={t(`${K}.confirm.title`)}
          message={t(`${K}.confirm.text`, { provider: asking.provider, model: asking.model })}
          confirmLabel={t(`${K}.routes.switchOff`)}
          onConfirm={() => {
            apply(asking);
          }}
          onCancel={cancel}
        />
      )}
    </main>
  );
}
