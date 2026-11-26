export type Direction = 'ltr' | 'rtl';

// Dev switch: `?dir=rtl` flips the page, so right-to-left is checked from day one.
export function directionFromSearch(search: string): Direction {
  return new URLSearchParams(search).get('dir') === 'rtl' ? 'rtl' : 'ltr';
}
