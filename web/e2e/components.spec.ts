import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// The interactive parts the keyboard test must reach. A roving group (radio-like) counts
// once: only its checked member is a tab stop.
const TABBABLE =
  '[data-gallery] :is(a[href], button:not([role=radio]), input:not([type=radio]), select, textarea, [role=radio][aria-checked=true]):not(:disabled)';

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
  await expect(page.locator('[data-gallery="button"]').getByRole('status')).toHaveText(
    'Pressed 1 times',
  );
  await page.keyboard.press('Space');
  await expect(page.locator('[data-gallery="button"]').getByRole('status')).toHaveText(
    'Pressed 2 times',
  );
});

test('inputs, select, checkbox and switch work from the keyboard', async ({ page }) => {
  await page.getByLabel('Display name').fill('Narimane');
  await expect(page.getByLabel('Display name')).toHaveValue('Narimane');

  const password = page.getByLabel('Password', { exact: true });
  await expect(password).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Show password' }).press('Enter');
  await expect(password).toHaveAttribute('type', 'text');
  const hints = {
    autocomplete: 'current-password',
    spellcheck: 'false',
    autocapitalize: 'off',
    autocorrect: 'off',
  };
  for (const [name, value] of Object.entries(hints)) {
    await expect(password).toHaveAttribute(name, value);
  }

  await page.getByLabel('Language').selectOption('ar');
  await expect(page.getByLabel('Language')).toHaveValue('ar');

  const box = page.getByRole('checkbox', { name: 'Remember this device' });
  await box.press('Space');
  await expect(box).toBeChecked();

  const toggle = page.getByRole('switch', { name: 'Notifications' });
  await toggle.press('Space');
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.press('Enter');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await page.getByText('Notifications', { exact: true }).click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
});

test('the code input keeps six digits and the three-way control moves with arrows', async ({
  page,
}) => {
  const code = page.getByLabel('Authenticator code');
  await code.fill('');
  await code.pressSequentially('12ab34567');
  await expect(code).toHaveValue('123456');

  const rtl = (await page.evaluate(() => document.documentElement.dir)) === 'rtl';
  const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
  const group = page.getByRole('radiogroup', { name: 'Send email' });
  await group.getByRole('radio', { name: 'Ask' }).focus();
  await page.keyboard.press(forward);
  await expect(group.getByRole('radio', { name: 'Auto' })).toBeChecked();
  await expect(page.getByText('Auto sends without asking')).toHaveCount(2);
  await page.keyboard.press('Home');
  await expect(group.getByRole('radio', { name: 'Off' })).toBeChecked();
  await expect(page.getByText('Auto sends without asking')).toHaveCount(1);
});

test('the dialog traps focus, closes with Escape and gives focus back', async ({ page }) => {
  const opener = page.getByRole('button', { name: 'Open dialog' });
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Delete this chat?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await expect(dialog).toHaveScreenshot('dialog-open.png');

  const result = await new AxeBuilder({ page }).include('dialog').analyze();
  expect(result.violations).toEqual([]);

  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test('a toast is announced and can be dismissed from the keyboard', async ({ page }) => {
  await page.getByRole('button', { name: 'Show toast' }).press('Enter');
  const live = page.locator('[aria-live=polite]');
  await expect(live).toContainText('Chat saved');
  await live.getByRole('button', { name: 'Dismiss' }).press('Enter');
  await expect(live).not.toContainText('Chat saved');
});
