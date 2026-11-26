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
  preset: Preset;
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

/** A stored preset as a profile. A type it does not list, or lists with an unknown mode, is `off`. */
const toProfile = (row: PresetRow | undefined): Profile =>
  Object.fromEntries(
    ACTION_TYPES.map((type) => {
      const mode: unknown = row?.modes[type];
      return [type, isMode(mode) ? mode : 'off'];
    }),
  ) as Profile;

/** The profile an assignment resolves to, from the stored presets. */
function resolve(presets: PresetRow[], assigned: Assigned): AccessProfile {
  const preset = presetFor(assigned);
  const stored = presets.find((row) => row.preset === preset);
  return { preset, modes: toProfile(stored), shellGate: stored?.shellGate ?? 'risky_only' };
}

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
  warnings: RiskWarning[];
}

/**
 * The admin sets a preset for a person, or for one of their devices. Undefined when refused. The
 * result lists a risk warning for each action type that is now looser than before. Nobody may set
 * their own profile to Restricted (the database refuses and audits it).
 */
export async function assignProfile(
  db: Db,
  caller: Owner,
  target: { userId: string; deviceId?: string | undefined; preset: Preset },
): Promise<Assignment | undefined> {
  const before = await assignPreset(db, caller, target);
  if (before === undefined) return undefined;
  const presets = await listPresets(db);
  const modesOf = (name: Preset): Profile => toProfile(presets.find((row) => row.preset === name));
  const previous = presetFor(before);
  return {
    previous,
    preset: target.preset,
    warnings: loosened(modesOf(previous), modesOf(target.preset)),
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
  const base = { role: overview.role, personPreset: overview.personPreset };
  return {
    person: resolve(presets, { ...base, devicePreset: undefined }),
    devices: overview.devices.map((device) => ({
      ...resolve(presets, { ...base, devicePreset: device.preset }),
      deviceId: device.id,
      channel: device.channel,
      own: device.preset !== undefined,
    })),
  };
}
