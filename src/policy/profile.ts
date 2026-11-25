import { ACTION_TYPES, type ActionType } from '../tools/index.js';

/** `off`: never. `ask`: only with a person's approval (M1-6). `auto`: run at once. */
export type Mode = 'off' | 'ask' | 'auto';
export type Profile = Readonly<Record<ActionType, Mode>>;

/** The one built-in profile (M1-5): reads run alone, anything that can change something asks. */
export const OWNER_PROFILE: Profile = Object.fromEntries(
  ACTION_TYPES.map((type) => [type, type === 'read' ? 'auto' : 'ask']),
) as Profile;

export const decide = (profile: Profile, actionType: ActionType): Mode => profile[actionType];
