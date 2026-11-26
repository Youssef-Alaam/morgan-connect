import { describe, expect, it } from 'vitest';
import { fontsWithoutLicence, packagesIn } from '../../scripts/check-web-licences.mjs';

describe('packagesIn', () => {
  it('lists nested packages and skips the workspace link', () => {
    const tree = {
      dependencies: {
        web: {
          version: '0.0.0',
          resolved: 'file:../web',
          dependencies: { react: { version: '19.0.0', dependencies: { x: { version: '1.0.0' } } } },
        },
      },
    };
    expect([...packagesIn(tree)].sort()).toEqual(['react@19.0.0', 'x@1.0.0']);
  });
});

describe('fontsWithoutLicence', () => {
  const entries = [{ dir: 'web/public/fonts', licenceFile: 'OFL.txt' }];

  it('passes a font with its licence file beside it', () => {
    expect(fontsWithoutLicence(['web/public/fonts/a.woff2'], entries, () => true)).toEqual([]);
  });

  it('fails a font whose licence file is missing', () => {
    expect(fontsWithoutLicence(['web/public/fonts/a.woff2'], entries, () => false)).toEqual([
      'web/public/fonts/a.woff2',
    ]);
  });

  it('fails a font in a folder with no allowlist entry', () => {
    expect(fontsWithoutLicence(['web/public/other/a.woff2'], entries, () => true)).toEqual([
      'web/public/other/a.woff2',
    ]);
  });
});
