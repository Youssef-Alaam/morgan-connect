import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { type Person, type Profiles as Shown } from '../api.ts';
import { type Choice } from '../profiles-api.ts';
import { Banner } from '../components/Banner.tsx';
import { Button } from '../components/Button.tsx';
import { Select } from '../components/Select.tsx';
import { Table } from '../components/Table.tsx';
import { ThreeWay } from '../components/ThreeWay.tsx';
import { ErrorBanner } from './ErrorBanner.tsx';
import { TopBar } from './TopBar.tsx';
import { useProfiles, type Editing, type Focus, type Pending } from './useProfiles.ts';

const K = 'profiles';
const PRESETS = ['restricted', 'standard', 'trusted'] as const;

interface ReviewProps {
  pending: Pending;
  busy: boolean;
  onSave: () => void;
  onCancel: () => void;
}

/** The choice and Save; each loosened type's risk is shown at its control in the table above. */
function Review({ pending, busy, onSave, onCancel }: ReviewProps) {
  const { t } = useTranslation();
  const { preview, choice, target } = pending;
  const risky = preview.warnings.length > 0;
  return (
    <section aria-label={t(`${K}.review`, { target })} dir="auto">
      {preview.refused ? (
        <Banner tone="danger" label={t('errors.label')}>
          {t(`${K}.refused`)}
        </Banner>
      ) : null}
      {risky ? <p>{t(`${K}.loosens`, { count: preview.warnings.length })}</p> : null}
      <p>
        {t(`${K}.confirmText`, {
          target,
          preset: t(`${K}.${choice.modes === undefined ? choice.preset : 'custom'}`),
        })}
      </p>
      <Button
        variant={risky ? 'primary' : 'secondary'}
        disabled={preview.refused || busy}
        onClick={onSave}
      >
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
  custom: boolean;
  own: boolean;
  deviceId?: string;
}

/** A channel's display name (Telegram), else its id as stored. */
const channelName = (channel: string, t: TFunction): string =>
  t(`${K}.channel.${channel}`, { defaultValue: channel });

/** The person's own row, then one per chat. */
function rowsOf(person: Person, shown: Shown, t: TFunction): Row[] {
  const name = person.email ?? t(`${K}.chatOnly`);
  return [
    {
      key: person.id,
      target: name,
      label: t(`${K}.forPerson`),
      preset: shown.person.preset,
      custom: shown.person.custom,
      own: true,
    },
    ...shown.devices.map((device) => ({
      key: device.deviceId,
      target: t(`${K}.chatOf`, { channel: channelName(device.channel, t), person: name }),
      label: t(device.own ? `${K}.forChat` : `${K}.forChatInherited`, {
        channel: channelName(device.channel, t),
      }),
      preset: device.preset,
      custom: device.custom,
      own: device.own,
      deviceId: device.deviceId,
    })),
  ];
}

interface TargetsProps {
  person: Person;
  shown: Shown;
  pending: Pending | undefined;
  focus: Focus | undefined;
  onPick: (choice: Choice, target: string) => void;
  onEdit: (focus: Focus) => void;
  onCancel: () => void;
}

/** What the dropdown shows: the choice waiting to be saved for this row, else what applies. */
function shownValue(pending: Pending | undefined, userId: string, row: Row): string {
  const mine = pending?.choice.userId === userId && pending.choice.deviceId === row.deviceId;
  if (mine) return pending.choice.modes === undefined ? pending.choice.preset : 'custom';
  return row.custom ? 'custom' : row.preset;
}

/** The person and each of their chats, each with the profile that applies and a way to change it. */
function Targets({ person, shown, pending, focus, onPick, onEdit, onCancel }: TargetsProps) {
  const { t } = useTranslation();
  const presets = PRESETS.map((value) => ({ value, label: t(`${K}.${value}`) }));
  const custom = { value: 'custom', label: t(`${K}.custom`) };
  return (
    <Table
      caption={t(`${K}.caption`, { person: person.email ?? t(`${K}.chatOnly`) })}
      columns={[t(`${K}.applies`), t(`${K}.profile`), t(`${K}.perAction`)]}
      rows={rowsOf(person, shown, t).map((row) => ({
        key: row.key,
        cells: [
          row.label,
          <Select
            key="profile"
            label={t(`${K}.profileFor`, { target: row.target })}
            hideLabel
            options={
              shownValue(pending, person.id, row) === 'custom' ? [...presets, custom] : presets
            }
            value={shownValue(pending, person.id, row)}
            onChange={(event) => {
              const preset = PRESETS.find((value) => value === event.target.value);
              if (preset === undefined) return;
              if (preset === row.preset && row.own && !row.custom) {
                onCancel(); // nothing to change
                return;
              }
              const device = row.deviceId === undefined ? {} : { deviceId: row.deviceId };
              onPick({ userId: person.id, preset, ...device }, row.target);
            }}
          />,
          <Button
            key="edit"
            variant="secondary"
            aria-pressed={focus?.deviceId === row.deviceId}
            onClick={() => {
              const device = row.deviceId === undefined ? {} : { deviceId: row.deviceId };
              onEdit({ target: row.target, ...device });
            }}
          >
            {t(`${K}.edit`)}
            <span className="visually-hidden"> {t(`${K}.editFor`, { target: row.target })}</span>
          </Button>,
        ],
      }))}
    />
  );
}

interface ModesProps {
  editing: Editing;
  pending: Pending | undefined;
  onPick: (choice: Choice, target: string) => void;
}

/** Off / ask / auto for each action type of the profile being edited, each risk shown at its type. */
function Modes({ editing, pending, onPick }: ModesProps) {
  const { t } = useTranslation();
  const labels = { off: t(`${K}.off`), ask: t(`${K}.ask`), auto: t(`${K}.auto`) };
  return (
    <Table
      caption={t(`${K}.allows`, { target: editing.target })}
      columns={[t(`${K}.action`), t(`${K}.mode`)]}
      rows={Object.entries(editing.modes).map(([type, mode]) => {
        const risk = pending?.preview.warnings.find((warning) => warning.actionType === type);
        return {
          key: type,
          cells: [
            <span key="type" dir="auto">
              {t(`${K}.type.${type}`)}
            </span>,
            <ThreeWay
              key="mode"
              label={t(`${K}.modeFor`, { type: t(`${K}.type.${type}`) })}
              value={mode}
              labels={labels}
              {...(risk === undefined ? {} : { risk: t(risk.warning) })}
              onChange={(next) => {
                const modes = { ...editing.modes, [type]: next };
                onPick({ ...editing.choice, modes }, editing.target);
              }}
            />,
          ],
        };
      })}
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
          focus={page.focus}
          onPick={page.pick}
          onEdit={page.edit}
          onCancel={page.cancel}
        />
      ) : null}
      {page.editing === undefined ? null : (
        <Modes editing={page.editing} pending={page.pending} onPick={page.pick} />
      )}
      {page.pending === undefined ? null : (
        <Review
          pending={page.pending}
          busy={page.saving}
          onSave={page.save}
          onCancel={page.cancel}
        />
      )}
    </main>
  );
}
