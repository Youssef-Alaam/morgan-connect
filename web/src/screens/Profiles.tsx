import { useTranslation } from 'react-i18next';
import { type Mode, type Person, type PresetRow, type Profiles as Shown } from '../api.ts';
import { Badge } from '../components/Badge.tsx';
import { Button } from '../components/Button.tsx';
import { Select } from '../components/Select.tsx';
import { Table } from '../components/Table.tsx';
import { ErrorBanner } from './ErrorBanner.tsx';
import { TopBar } from './TopBar.tsx';
import { useProfiles } from './useProfiles.ts';

const K = 'profiles';

interface TargetsProps {
  person: Person;
  shown: Shown;
}

/** The profile that applies to the person and to each of their chats. */
function Targets({ person, shown }: TargetsProps) {
  const { t } = useTranslation();
  const rows = [
    { key: person.id, label: t(`${K}.forPerson`), preset: shown.person.preset, own: true },
    ...shown.devices.map((device) => ({
      key: device.deviceId,
      label: t(`${K}.forChat`, { channel: device.channel }),
      preset: device.preset,
      own: device.own,
    })),
  ];
  return (
    <Table
      caption={t(`${K}.caption`, { person: person.email ?? t(`${K}.chatOnly`) })}
      columns={[t(`${K}.applies`), t(`${K}.profile`)]}
      rows={rows.map((row) => ({
        key: row.key,
        cells: [
          row.label,
          row.own
            ? t(`${K}.${row.preset}`)
            : t(`${K}.inherits`, { preset: t(`${K}.${row.preset}`) }),
        ],
      }))}
    />
  );
}

interface ModesProps {
  preset: string | undefined;
  presets: PresetRow[];
}

const RANK = { off: 0, ask: 1, auto: 2 } as const;

/** Red only where the setting is looser than Restricted allows for that action type. */
function looser(mode: Mode, base: Mode | undefined): boolean {
  return base !== undefined && RANK[mode] > RANK[base];
}

/** What a profile lets Morgan do, per action type: the off / ask / auto setting of each. */
function Modes({ preset, presets }: ModesProps) {
  const { t } = useTranslation();
  const row = presets.find((candidate) => candidate.preset === preset);
  if (row === undefined) return null;
  const base = presets.find((candidate) => candidate.preset === 'restricted')?.modes;
  return (
    <Table
      caption={t(`${K}.allows`, { preset: t(`${K}.${row.preset}`) })}
      columns={[t(`${K}.action`), t(`${K}.mode`)]}
      rows={Object.entries(row.modes).map(([type, mode]) => ({
        key: type,
        cells: [
          t(`${K}.type.${type}`),
          <Badge key="mode" tone={looser(mode, base?.[type]) ? 'danger' : 'neutral'}>
            {t(`${K}.${mode}`)}
          </Badge>,
        ],
      }))}
    />
  );
}

interface ProfilesProps {
  onBack: () => void;
  onSignedOut: () => void;
}

// The admin's page for access profiles: what each person and chat may do.
export function Profiles({ onBack, onSignedOut }: ProfilesProps) {
  const { t } = useTranslation();
  const page = useProfiles();
  const person = page.people?.find((candidate) => candidate.id === page.who);
  return (
    <main className="page screen screen-wide">
      <TopBar onSignedOut={onSignedOut}>
        <Button variant="secondary" onClick={onBack}>
          {t(`${K}.back`)}
        </Button>
      </TopBar>
      <h2>{t(`${K}.title`)}</h2>
      <ErrorBanner error={page.error} />
      {page.people === undefined ? (
        <p>{t('app.loading')}</p>
      ) : (
        <Select
          label={t(`${K}.person`)}
          value={page.who ?? ''}
          options={page.people.map((one) => ({
            value: one.id,
            label: one.email ?? t(`${K}.chatOnly`),
          }))}
          onChange={(event) => {
            page.choosePerson(event.target.value);
          }}
        />
      )}
      {person !== undefined && page.shown !== undefined ? (
        <Targets person={person} shown={page.shown} />
      ) : null}
      <Modes preset={page.shown?.person.preset} presets={page.presets} />
    </main>
  );
}
