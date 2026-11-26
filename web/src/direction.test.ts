import { describe, expect, it } from 'vitest';
import { directionFromSearch } from './direction.ts';

describe('directionFromSearch', () => {
  it('flips to right-to-left with ?dir=rtl', () => {
    expect(directionFromSearch('?dir=rtl')).toBe('rtl');
  });

  it.each(['', '?dir=ltr', '?dir=sideways', '?other=rtl'])('stays left-to-right for "%s"', (s) => {
    expect(directionFromSearch(s)).toBe('ltr');
  });
});
