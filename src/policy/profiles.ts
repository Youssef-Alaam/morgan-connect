import {
  assignedTo,
  assignPreset,
  overviewOf,
  listPresets,
  type Assigned,
  type Db,
  type Owner,
  type PresetRow,
  type ShellGate,
} from '../data/index.js';
import { ACTION_TYPES, type ActionType } from '../tools/index.js';
import { decide, type Mode, type Profile } from './profile.js';

/** The three presets the admin picks from (A5). Their values are stored in `access_profiles`. */
export const PRESETS = ['restricted', 'standard', 'trusted'] as const;
export type Preset = (typeof PRESETS)[number];

/** The profile that applies to one device: what each action type may do, and the shell-gate level. */
export interface AccessProfile {
  /** With `custom`, the preset the admin started from; the modes are their own. */
  preset: Preset;
  custom: boolean;
  modes: Profile;
  shellGate: ShellGate;
}

const isPreset = (value: string | undefined): value is Preset =>
  PRESETS.some((preset) => preset === value);
const isMode = (value: unknown): value is Mode =>
  value === 'off' || value === 'ask' || value === 'auto';

/** A person nobody has assigned: the admin keeps today's ask-for-everything; a member starts shut. */
const defaultPreset = (role: string): Preset => (role === 'admin' ? 'standard' : 'restricted');

/** The preset that applies: the device's own choice, else the person's, else the role's default. */
export function presetFor(assigned: Assigned): Preset {
  const chosen = assigned.devicePreset ?? assigned.personPreset;
  return isPreset(chosen) ? chosen : defaultPreset(assigned.role);
}

/** Stored modes as a profile. A type they do not list, or list with an unknown mode, is `off`. */
const toProfile = (modes: Readonly<Record<string, unknown>> | undefined): Profile =>
  Object.fromEntries(
    ACTION_TYPES.map((type) => {
      const mode: unknown = modes?.[type];
      return [type, isMode(mode) ? mode : 'off'];
    }),
  ) as Profile;

/** The profile an assignment resolves to: its own custom modes, else the stored preset's. */
function resolve(presets: PresetRow[], assigned: Assigned): AccessProfile {
  const preset = presetFor(assigned);
  const stored = presets.find((row) => row.preset === preset);
  const own = assigned.devicePreset === undefined ? assigned.personModes : assigned.deviceModes;
  return {
    preset,
    custom: own !== undefined,
    modes: toProfile(own ?? stored?.modes),
    shellGate: stored?.shellGate ?? 'risky_only',
  };
}

/** Custom modes as sent by the admin's page: every action type exactly once, each a known mode. */
export function asModes(value: unknown): Profile | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const entries = Object.entries(value);
  const known = entries.every(
    ([type, mode]) => ACTION_TYPES.some((t) => t === type) && isMode(mode),
  );
  return known && entries.length === ACTION_TYPES.length
    ? toProfile(Object.fromEntries(entries))
    : undefined;
}

/** Nothing but reading left on: Restricted, or custom modes that amount to it. */
const shut = (modes: Profile): boolean =>
  ACTION_TYPES.every((type) => type === 'read' || decide(modes, type) === 'off');

/**
 * The profile for this person on this chat (the gate's question in M2-9b). A damaged preset row
 * never opens a door: what it does not say clearly is `off`.
 */
export async function profileFor(
  db: Db,
  owner: Owner,
  device?: { channel: string; chatId: string },
): Promise<AccessProfile> {
  return resolve(await listPresets(db), await assignedTo(db, owner, device));
}

/** A grant that loosens one action type, with the translation key of its risk warning (D27). */
export interface RiskWarning {
  actionType: ActionType;
  from: Mode;
  to: Mode;
  warning: string;
}

const RANK: Record<Mode, number> = { off: 0, ask: 1, auto: 2 };

/** Every action type the new profile allows more freely than the old one, each with its warning. */
export function loosened(before: Profile, after: Profile): RiskWarning[] {
  return ACTION_TYPES.flatMap((type) => {
    const [from, to] = [decide(before, type), decide(after, type)];
    return RANK[to] > RANK[from]
      ? [{ actionType: type, from, to, warning: `profile.risk.${type}.${to}` }]
      : [];
  });
}

export interface Assignment {
  previous: Preset;
  preset: Preset;
  custom: boolean;
  warnings: RiskWarning[];
}

/** A choice: a preset, or custom modes per action type (with the preset they started from). */
interface Target {
  userId: string;
  deviceId?: string | undefined;
  preset: Preset;
  modes?: Profile | undefined;
}

const modesOf = (presets: PresetRow[], target: Target): Profile =>
  target.modes === undefined
    ? toProfile(presets.find((row) => row.preset === target.preset)?.modes)
    : toProfile(target.modes);

/**
 * The admin sets a preset for a person, or for one of their devices. Undefined when refused. The
 * result lists a risk warning for each action type that is now looser than before. Nobody may set
 * their own profile to Restricted (the database refuses and audits it).
 */
export async function assignProfile(
  db: Db,
  caller: Owner,
  target: Target,
): Promise<Assignment | undefined> {
  const { modes, ...rest } = target;
  const before = await assignPreset(db, caller, modes === undefined ? rest : { ...rest, modes });
  if (before === undefined) return undefined;
  const presets = await listPresets(db);
  const previous = resolve(presets, before);
  return {
    previous: previous.preset,
    preset: target.preset,
    custom: modes !== undefined,
    warnings: loosened(previous.modes, modesOf(presets, target)),
  };
}

/**
 * What a choice would loosen, worked out the same way as `assignProfile` but writing nothing. For
 * the admin's page, which shows the warnings before it saves. Undefined when the person, or the
 * device (which must be theirs), is not found.
 */
export async function previewProfile(
  db: Db,
  caller: Owner,
  target: Target,
): Promise<(Assignment & { refused: boolean }) | undefined> {
  const current = await profilesOf(db, caller, target.userId);
  if (current === undefined) return undefined;
  const now =
    target.deviceId === undefined
      ? current.person
      : current.devices.find((device) => device.deviceId === target.deviceId);
  if (now === undefined) return undefined;
  const presets = await listPresets(db);
  const next = modesOf(presets, target);
  // The database refuses an admin shutting themselves out, person or device (migration 0040).
  const refused = target.userId === caller.userId && shut(next);
  return {
    previous: now.preset,
    preset: target.preset,
    custom: target.modes !== undefined,
    warnings: loosened(now.modes, next),
    refused,
  };
}

export interface DeviceProfile extends AccessProfile {
  deviceId: string;
  channel: string;
  /** False when the device takes its person's profile. */
  own: boolean;
}

/** The profile that applies to a person and to each of their chats. Undefined when not allowed. */
export async function profilesOf(
  db: Db,
  caller: Owner,
  userId: string,
): Promise<{ person: AccessProfile; devices: DeviceProfile[] } | undefined> {
  const overview = await overviewOf(db, caller, userId);
  if (overview === undefined) return undefined;
  const presets = await listPresets(db);
  const base = {
    role: overview.role,
    personPreset: overview.personPreset,
    personModes: overview.personModes,
  };
  return {
    person: resolve(presets, { ...base, devicePreset: undefined }),
    devices: overview.devices.map((device) => ({
      ...resolve(presets, { ...base, devicePreset: device.preset, deviceModes: device.modes }),
      deviceId: device.id,
      channel: device.channel,
      own: device.preset !== undefined,
    })),
  };
}
