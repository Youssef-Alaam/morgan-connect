import { expect, it } from 'vitest';
import { loosened, presetFor } from './profiles.js';
import type { Profile } from './profile.js';

const modes = (create: 'off' | 'ask' | 'auto'): Profile => ({
  read: 'auto',
  create,
  overwrite: 'off',
  delete: 'off',
  send: 'off',
  execute: 'off',
});

it('takes the device choice, then the person, then the role default', () => {
  const base = { role: 'member', personPreset: undefined, devicePreset: undefined };
  expect(presetFor(base)).toBe('restricted');
  expect(presetFor({ ...base, role: 'admin' })).toBe('standard');
  expect(presetFor({ ...base, personPreset: 'trusted' })).toBe('trusted');
  expect(presetFor({ ...base, personPreset: 'trusted', devicePreset: 'standard' })).toBe(
    'standard',
  );
  expect(presetFor({ ...base, personPreset: 'bogus' })).toBe('restricted');
});

it('lists only the types that become looser', () => {
  expect(loosened(modes('off'), modes('ask'))).toEqual([
    { actionType: 'create', from: 'off', to: 'ask', warning: 'profile.risk.create.ask' },
  ]);
  expect(loosened(modes('auto'), modes('ask'))).toEqual([]);
  expect(loosened(modes('ask'), modes('ask'))).toEqual([]);
});
