import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// The interactive parts the keyboard test must reach. A roving group (radio-like) counts
// once: only its checked member is a tab stop.
const TABBABLE =
  '[data-gallery] :is(a[href], button, input:not([type=radio]), select, textarea, [role=radio][aria-checked=true]):not(:disabled)';

async function openGallery(page: Page, query: string): Promise<void> {
  await page.goto(`/components${query}`);
  await page.evaluate(() => document.fonts.ready);
}

const queryOf = (metadata: unknown): string =>
  typeof metadata === 'object' && metadata !== null && 'query' in metadata
    ? String(metadata.query)
    : '';

test.beforeEach(async ({ page }, info) => {
  await openGallery(page, queryOf(info.project.metadata));
});

test('every component section looks the same as its saved picture', async ({ page }) => {
  const names = await page
    .locator('[data-gallery]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-gallery') ?? ''));
  expect(names.length).toBeGreaterThan(0);
  for (const name of names) {
    await expect(page.locator(`[data-gallery="${name}"]`)).toHaveScreenshot(`${name}.png`);
  }
});

test('the page has no accessibility violations', async ({ page }) => {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(result.violations).toEqual([]);
});

test('every interactive part is reachable by keyboard with a visible focus ring', async ({
  page,
}) => {
  for (let step = 0; step < 300; step += 1) {
    await page.keyboard.press('Tab');
    const ring = await page.evaluate(() => {
      const el = document.activeElement;
      if (el === null || el === document.body || el.hasAttribute('data-visited')) return null;
      el.setAttribute('data-visited', '');
      const style = getComputedStyle(el);
      return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
    });
    if (ring === null) break;
    expect(ring.style).not.toBe('none');
    expect(ring.width).toBeGreaterThan(0);
  }
  await expect(page.locator(`${TABBABLE}:not([data-visited])`)).toHaveCount(0);
});

test('a button can be pressed with the keyboard', async ({ page }) => {
  const press = page.getByRole('button', { name: 'Press me' });
  await press.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toHaveText('Pressed 1 times');
  await page.keyboard.press('Space');
  await expect(page.getByRole('status')).toHaveText('Pressed 2 times');
});
