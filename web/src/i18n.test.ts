import { describe, expect, it } from 'vitest';
import { i18n } from './i18n.ts';

describe('i18n', () => {
  it('serves English strings by key', () => {
    expect(i18n.t('app.name')).toBe('Morgan Connect');
  });
});
