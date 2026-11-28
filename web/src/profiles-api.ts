import { call, type Mode, type Preset, type Result } from './api.ts';

// The calls that change a profile from the admin's page (M2-15b).
/** A choice: for the person, or for one of their chats when `deviceId` is given. */
export interface Choice {
  userId: string;
  deviceId?: string;
  preset: Preset;
  /** Off / ask / auto per action type, instead of the preset's own. */
  modes?: Record<string, Mode>;
}

export interface Preview {
  previous: Preset;
  warnings: { actionType: string; to: Mode; warning: string }[];
  refused: boolean;
}

/** What the choice would loosen, before it is saved. Writes nothing. */
export function previewProfile(choice: Choice): Promise<Result<Preview>> {
  const query = new URLSearchParams({ userId: choice.userId, preset: choice.preset });
  if (choice.deviceId !== undefined) query.set('deviceId', choice.deviceId);
  if (choice.modes !== undefined) query.set('modes', JSON.stringify(choice.modes));
  return call(`/admin/profile-preview?${query.toString()}`);
}

/** Saves the choice; the server writes the audit row. */
export function saveProfile(choice: Choice): Promise<Result<unknown>> {
  const { userId, ...body } = choice;
  return call(`/members/${encodeURIComponent(userId)}/profile`, body, 'PUT');
}
