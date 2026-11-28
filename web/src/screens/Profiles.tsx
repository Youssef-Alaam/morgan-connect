import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { type Mode, type Person, type PresetRow, type Profiles as Shown } from '../api.ts';
import { type Choice } from '../profiles-api.ts';
import { Badge } from '../components/Badge.tsx';
import { Banner } from '../components/Banner.tsx';
import { Button } from '../components/Button.tsx';
import { Select } from '../components/Select.tsx';
import { Table } from '../components/Table.tsx';
import { ErrorBanner } from './ErrorBanner.tsx';
import { TopBar } from './TopBar.tsx';
import { useProfiles, type Pending } from './useProfiles.ts';

const K = 'profiles';
const PRESETS = ['restricted', 'standard', 'trusted'] as const;

interface ReviewProps {
  pending: Pending;
  busy: boolean;
  onSave: () => void;
  onCancel: () => void;
}

/** The risk warning of every action type the choice loosens, shown before it is saved. */
function Review({ pending, busy, onSave, onCancel }: ReviewProps) {
  const { t } = useTranslation();
  const { preview, choice, target } = pending;
  return (
    <section aria-label={t(`${K}.review`, { target })}>
      {preview.refused ? (
        <Banner tone="danger" label={t('errors.label')}>
          {t(`${K}.refused`)}
        </Banner>
      ) : null}
      {preview.warnings.map((warning) => (
        <Banner key={warning.actionType} tone="warning" label={t(`${K}.risk`)}>
          {t(warning.warning)}
        </Banner>
      ))}
      <p>{t(`${K}.confirmText`, { target, preset: t(`${K}.${choice.preset}`) })}</p>
      <Button disabled={preview.refused || busy} onClick={onSave}>
        {t(`${K}.save`)}
      </Button>{' '}
      <Button variant="secondary" onClick={onCancel}>
        {t(`${K}.cancel`)}
      </Button>
    </section>
  );
}

interface Row {
  key: string;
  target: string;
  label: string;
  preset: Shown['person']['preset'];
  own: boolean;
  deviceId?: string;
}

/** The person's own row, then one per chat. */
function rowsOf(person: Person, shown: Shown, t: TFunction): Row[] {
  const name = person.email ?? t(`${K}.chatOnly`);
  return [
    {
      key: person.id,
      target: name,
      label: t(`${K}.forPerson`),
      preset: shown.person.preset,
      own: true,
    },
    ...shown.devices.map((device) => ({
      key: device.deviceId,
      target: t(`${K}.chatOf`, { channel: device.channel, person: name }),
      label: t(device.own ? `${K}.forChat` : `${K}.forChatInherited`, { channel: device.channel }),
      preset: device.preset,
      own: device.own,
      deviceId: device.deviceId,
    })),
  ];
}

interface TargetsProps {
  person: Person;
  shown: Shown;
  pending: Pending | undefined;
  onPick: (choice: Choice, target: string) => void;
  onCancel: () => void;
}

/** The preset the dropdown shows: the choice waiting to be saved for this row, else what applies. */
function shownValue(pending: Pending | undefined, userId: string, row: Row): string {
  const mine = pending?.choice.userId === userId && pending.choice.deviceId === row.deviceId;
  return mine ? pending.choice.preset : row.preset;
}

/** The person and each of their chats, each with the profile that applies and a way to change it. */
function Targets({ person, shown, pending, onPick, onCancel }: TargetsProps) {
  const { t } = useTranslation();
  const options = PRESETS.map((value) => ({ value, label: t(`${K}.${value}`) }));
  return (
    <Table
      caption={t(`${K}.caption`, { person: person.email ?? t(`${K}.chatOnly`) })}
      columns={[t(`${K}.applies`), t(`${K}.profile`)]}
      rows={rowsOf(person, shown, t).map((row) => ({
        key: row.key,
        cells: [
          row.label,
          <Select
            key="profile"
            label={t(`${K}.profileFor`, { target: row.target })}
            options={options}
            value={shownValue(pending, person.id, row)}
            onChange={(event) => {
              const preset = PRESETS.find((value) => value === event.target.value);
              if (preset === undefined) return;
              if (preset === row.preset && row.own) {
                onCancel(); // nothing to change
                return;
              }
              const device = row.deviceId === undefined ? {} : { deviceId: row.deviceId };
              onPick({ userId: person.id, preset, ...device }, row.target);
            }}
          />,
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

interface PickerProps {
  people: Person[];
  who: string | undefined;
  onPick: (id: string) => void;
}

function PersonPicker({ people, who, onPick }: PickerProps) {
  const { t } = useTranslation();
  return (
    <Select
      label={t(`${K}.person`)}
      value={who ?? ''}
      options={people.map((one) => ({ value: one.id, label: one.email ?? t(`${K}.chatOnly`) }))}
      onChange={(event) => {
        onPick(event.target.value);
      }}
    />
  );
}

interface ProfilesProps {
  onBack: () => void;
  onSignedOut: () => void;
}

// The admin's page for access profiles: what each person and chat may do, with the risk shown before any loosening is saved.
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
        <PersonPicker people={page.people} who={page.who} onPick={page.choosePerson} />
      )}
      {person !== undefined && page.shown !== undefined ? (
        <Targets
          person={person}
          shown={page.shown}
          pending={page.pending}
          onPick={page.pick}
          onCancel={page.cancel}
        />
      ) : null}
      {page.pending === undefined ? null : (
        <Review
          pending={page.pending}
          busy={page.saving}
          onSave={page.save}
          onCancel={page.cancel}
        />
      )}
      <Modes
        preset={page.pending?.choice.preset ?? page.shown?.person.preset}
        presets={page.presets}
      />
    </main>
  );
}
