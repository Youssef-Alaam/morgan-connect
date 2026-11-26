import { describe, expect, it } from 'vitest';
import { ACTION_TYPES, type ActionType } from '../tools/index.js';
import { decide, type Mode, type Profile } from './profile.js';

describe('decide', () => {
  const all = (mode: Mode): Profile =>
    Object.fromEntries(ACTION_TYPES.map((t) => [t, mode])) as Profile;
  const table = (['off', 'ask', 'auto'] as const).flatMap((mode) =>
    ACTION_TYPES.map((type) => [mode, type] as const),
  );
  it.each(table)('a profile set to %s decides %s as %s', (mode, type) => {
    expect(decide(all(mode), type)).toBe(mode);
  });

  it.each(['toString', '__proto__', 'surprise'])('an unlisted type %s is off', (type) => {
    expect(decide(all('auto'), type as ActionType)).toBe('off');
  });
});
