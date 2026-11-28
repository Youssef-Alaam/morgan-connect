import { expect, it } from 'vitest';
import { keyHint, providersFrom } from './providers.js';

const base = { ENGINE: 'pi' as const, ANTHROPIC_MODEL: 'm-1' };

it('shows the last four characters of a key, and nothing of a short one', () => {
  expect(keyHint('sk-ant-api03-abcdwxyz')).toBe('wxyz');
  expect(keyHint('short')).toBeNull();
  expect(keyHint('sixteen-chars-ab')).toBe('s-ab');
  expect(keyHint('fifteen-chars-a')).toBeNull();
  expect(keyHint(undefined)).toBeNull();
});

it('lists the Anthropic route only when its key is set', () => {
  expect(providersFrom(base)).toEqual({ routes: [], telegram: false });
  const set = providersFrom({
    ...base,
    ANTHROPIC_API_KEY: 'sk-ant-api03-abcdwxyz',
    TELEGRAM_BOT_TOKEN: 't',
  });
  expect(set).toEqual({
    routes: [{ id: 'anthropic', provider: 'Anthropic', model: 'm-1', keyLast4: 'wxyz' }],
    telegram: true,
  });
});

it('lists the own-engine route with its token hint', () => {
  const own = providersFrom({ ...base, ENGINE: 'http', ENGINE_TOKEN: 'engine-token-1234' });
  expect(own.routes).toEqual([
    { id: 'http', provider: 'Your own engine', model: 'http-engine', keyLast4: '1234' },
  ]);
  expect(JSON.stringify(own)).not.toContain('engine-token');
});
