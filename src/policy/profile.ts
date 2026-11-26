import type { ActionType } from '../tools/index.js';

/** `off`: never. `ask`: only with a person's approval (M1-6). `auto`: run at once. */
export type Mode = 'off' | 'ask' | 'auto';
export type Profile = Readonly<Record<ActionType, Mode>>;

/** A type the profile does not list is `off`, never an accident of the object (`toString`). */
export const decide = (profile: Profile, actionType: ActionType): Mode =>
  Object.hasOwn(profile, actionType) ? profile[actionType] : 'off';
