import { sql } from 'kysely';
import type { Db, Owner } from './db.js';
import { withOwner } from './tenancy.js';

/** The profile path (migration 0023); the app role may execute exactly this by name. */
export const PROFILE_FUNCTIONS: readonly string[] = [
  'admin_assign_profile(uuid, uuid, text)',
  'profiles_overview(uuid)',
];

export type ShellGate = 'strict' | 'risky_only' | 'off';

/** One stored preset: a mode per action type, as text (the policy layer reads them as types). */
export interface PresetRow {
  preset: string;
  modes: Record<string, string>;
  shellGate: ShellGate;
}

/** The stored presets. Fixed install-wide settings: the app role can read them, never change them. */
export async function listPresets(db: Db): Promise<PresetRow[]> {
  const rows = await db.selectFrom('access_profiles').selectAll().orderBy('preset').execute();
  return rows.map((row) => ({ preset: row.preset, modes: row.modes, shellGate: row.shell_gate }));
}

/** Which preset was chosen for a person and for one of their devices, if any. */
export interface Assigned {
  role: string;
  personPreset: string | undefined;
  devicePreset: string | undefined;
}

/** This person's own choices; `device` is the chat the message came from, when known. */
export function assignedTo(
  db: Db,
  owner: Owner,
  device: { channel: string; chatId: string } | undefined,
): Promise<Assigned> {
  return withOwner(db, owner, async (trx) => {
    const me = await trx
      .selectFrom('users')
      .select('role')
      .where('id', '=', owner.userId)
      .executeTakeFirstOrThrow();
    const rows = await trx
      .selectFrom('profile_assignments as a')
      .leftJoin('devices as d', 'd.id', 'a.device_id')
      .select(['a.device_id', 'a.preset'])
      .where((eb) =>
        eb.or([
          eb('a.device_id', 'is', null),
          device === undefined
            ? eb.lit(false)
            : eb.and([eb('d.channel', '=', device.channel), eb('d.chat_id', '=', device.chatId)]),
        ]),
      )
      .execute();
    return {
      role: me.role,
      personPreset: rows.find((row) => row.device_id === null)?.preset,
      devicePreset: rows.find((row) => row.device_id !== null)?.preset,
    };
  });
}

/**
 * The admin sets a preset for a person, or for one of their devices. Undefined when refused (not
 * the admin, or no such person or device in the workspace); else what was set before. The audit
 * row, ok or refused, is written in the same step.
 */
export async function assignPreset(
  db: Db,
  caller: Owner,
  target: { userId: string; deviceId?: string | undefined; preset: string },
): Promise<Assigned | undefined> {
  const { rows } = await withOwner(db, caller, (trx) =>
    sql<{ role: string; person_preset: string | null; device_preset: string | null }>`
      select * from admin_assign_profile(${target.userId}, ${target.deviceId ?? null}, ${target.preset})`.execute(
      trx,
    ),
  );
  const before = rows[0];
  if (before === undefined) return undefined;
  return {
    role: before.role,
    personPreset: before.person_preset ?? undefined,
    devicePreset: before.device_preset ?? undefined,
  };
}

/** What each of a person's chats is set to; `preset` is undefined where nobody chose one. */
export interface Overview {
  role: string;
  personPreset: string | undefined;
  devices: { id: string; channel: string; preset: string | undefined }[];
}

/** A person's own choices, or any person's in the workspace when the caller is the admin. */
export async function overviewOf(
  db: Db,
  caller: Owner,
  userId: string,
): Promise<Overview | undefined> {
  const { rows } = await withOwner(db, caller, (trx) =>
    sql<{ role: string; device_id: string | null; channel: string | null; preset: string | null }>`
      select * from profiles_overview(${userId})`.execute(trx),
  );
  const [person, ...devices] = rows;
  if (person === undefined) return undefined;
  return {
    role: person.role,
    personPreset: person.preset ?? undefined,
    devices: devices.map((row) => ({
      id: row.device_id ?? '',
      channel: row.channel ?? '',
      preset: row.preset ?? undefined,
    })),
  };
}
