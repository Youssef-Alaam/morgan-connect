import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listPeople, unlinkDevice, type Person } from '../api.ts';
import { Badge } from '../components/Badge.tsx';
import { Button } from '../components/Button.tsx';
import { Table } from '../components/Table.tsx';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { ErrorBanner } from './ErrorBanner.tsx';
import { Invites } from './Invites.tsx';
import { NewAccount } from './NewAccount.tsx';
import { TopBar } from './TopBar.tsx';

const K = 'users';

/** The chat the admin is about to unlink, named for the question. */
interface Asked {
  id: string;
  channel: string;
  person: string;
}

interface PeopleProps {
  people: Person[];
  onUnlink: (asked: Asked) => void;
}

function PeopleTable({ people, onUnlink }: PeopleProps) {
  const { t } = useTranslation();
  return (
    <Table
      caption={t(`${K}.caption`)}
      columns={[t(`${K}.person`), t(`${K}.role`), t(`${K}.status`), t(`${K}.chats`)]}
      rows={people.map((person) => {
        const name = person.email ?? t(`${K}.chatOnly`);
        return {
          key: person.id,
          cells: [
            name,
            t(`${K}.${person.role === 'admin' ? 'admin' : 'member'}`),
            <Badge key="status" tone={person.status === 'active' ? 'neutral' : 'danger'}>
              {t(`${K}.${person.status}`)}
            </Badge>,
            person.devices.length === 0 ? (
              t(`${K}.noChats`)
            ) : (
              <ul key="chats" className="plain-list">
                {person.devices.map((device) => (
                  <li key={device.id}>
                    {device.channel}{' '}
                    <Button
                      variant="secondary"
                      aria-label={t(`${K}.unlinkNamed`, { channel: device.channel, person: name })}
                      onClick={() => {
                        onUnlink({ id: device.id, channel: device.channel, person: name });
                      }}
                    >
                      {t(`${K}.unlink`)}
                    </Button>
                  </li>
                ))}
              </ul>
            ),
          ],
        };
      })}
    />
  );
}

interface AskProps {
  asked: Asked | undefined;
  onConfirm: (deviceId: string) => void;
  onCancel: () => void;
}

/** The question before a chat is unlinked: it names the channel and the person. */
function AskUnlink({ asked, onConfirm, onCancel }: AskProps) {
  const { t } = useTranslation();
  if (asked === undefined) return null;
  return (
    <ConfirmDialog
      title={t(`${K}.confirmUnlink`)}
      message={t(`${K}.confirmUnlinkText`, { channel: asked.channel, person: asked.person })}
      confirmLabel={t(`${K}.unlink`)}
      onConfirm={() => {
        onConfirm(asked.id);
      }}
      onCancel={onCancel}
    />
  );
}

interface UsersProps {
  onBack: () => void;
  onSignedOut: () => void;
}

// The admin's page for people: who is in the workspace, their role and status, and their linked chats.
export function Users({ onBack, onSignedOut }: UsersProps) {
  const { t } = useTranslation();
  const [people, setPeople] = useState<Person[]>();
  const [error, setError] = useState<string>();
  const load = useCallback(() => {
    void listPeople().then((answer) => {
      if (answer.ok) setPeople(answer.data.people);
      else setError(answer.error);
    });
  }, []);
  useEffect(load, [load]);
  const [asked, setAsked] = useState<Asked>();
  const unlink = (deviceId: string) => {
    setAsked(undefined);
    setError(undefined);
    void unlinkDevice(deviceId).then((answer) => {
      if (answer.ok) load();
      else setError(answer.error);
    });
  };
  return (
    <main className="page screen screen-wide">
      <TopBar onSignedOut={onSignedOut}>
        <Button variant="secondary" onClick={onBack}>
          {t(`${K}.back`)}
        </Button>
      </TopBar>
      <h2>{t(`${K}.title`)}</h2>
      <ErrorBanner error={error} />
      {people === undefined ? (
        error === undefined ? (
          <p>{t('app.loading')}</p>
        ) : null
      ) : (
        <PeopleTable people={people} onUnlink={setAsked} />
      )}
      <AskUnlink
        asked={asked}
        onConfirm={unlink}
        onCancel={() => {
          setAsked(undefined);
        }}
      />
      <Invites />
      <NewAccount onCreated={load} />
    </main>
  );
}
