import { describe, expect, it } from 'vitest';
import { ACTION_TYPES } from '../tools/index.js';
import { decide, OWNER_PROFILE, type Mode, type Profile } from './profile.js';

describe('decide', () => {
  const all = (mode: Mode): Profile =>
    Object.fromEntries(ACTION_TYPES.map((t) => [t, mode])) as Profile;
  const table = (['off', 'ask', 'auto'] as const).flatMap((mode) =>
    ACTION_TYPES.map((type) => [mode, type] as const),
  );
  it.each(table)('a profile set to %s decides %s as %s', (mode, type) => {
    expect(decide(all(mode), type)).toBe(mode);
  });

  it.each(ACTION_TYPES)('the owner profile decides %s', (type) => {
    expect(decide(OWNER_PROFILE, type)).toBe(type === 'read' ? 'auto' : 'ask');
  });
});
