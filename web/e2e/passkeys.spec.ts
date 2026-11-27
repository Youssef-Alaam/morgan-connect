import { expect, test, type Page, type Route } from '@playwright/test';
import { noViolations, open, queryOf, signedIn } from './support.ts';

// The passkeys on the security page, against a scripted API.
const LAPTOP = { id: 'p1', name: 'Laptop', createdAt: '2026-11-01T09:00:00Z', lastUsedAt: null };
const PHONE = {
  id: 'p2',
  name: 'Phone',
  createdAt: '2026-11-10T09:00:00Z',
  lastUsedAt: '2026-11-25T18:30:00Z',
};

/**
 * `GET /passkeys` answers each list in turn (the last repeats), `POST` goes to `add`;
 * `/two-factor` says it is off.
 */
async function script(
  page: Page,
  lists: object[][],
  add: (route: Route) => Promise<void> = (route) => route.fulfill({ status: 404, json: {} }),
): Promise<void> {
  await signedIn(page);
  await page.route('**/api/two-factor', (route) =>
    route.fulfill({ json: { available: true, enabled: false } }),
  );
  await page.route('**/api/passkeys', (route) =>
    route.request().method() === 'POST'
      ? add(route)
      : route.fulfill({ json: lists.length > 1 ? lists.shift() : lists[0] }),
  );
}

async function openSecurity(page: Page, info: { project: { metadata: unknown } }): Promise<void> {
  await open(page, queryOf(info.project.metadata));
  await page.getByRole('button', { name: 'Security' }).click();
  await expect(page.getByRole('heading', { name: 'Passkeys' })).toBeVisible();
}

test('the passkeys are listed with when they were added and last used', async ({ page }, info) => {
  await script(page, [[LAPTOP, PHONE]]);
  await openSecurity(page, info);
  const table = page.getByRole('table', { name: 'Your passkeys' });
  await expect(table.getByRole('row')).toHaveCount(3);
  await expect(table).toContainText('Phone');
  await expect(table).toContainText('2026-11-25');
  await expect(page.locator('main')).toHaveScreenshot('security-passkeys.png');
  await noViolations(page);
});

test('a passkey is removed and the list refreshes; none left says so', async ({ page }, info) => {
  await script(page, [[LAPTOP], []]);
  let removed = '';
  await page.route('**/api/passkeys/p1', async (route) => {
    removed = route.request().method();
    await route.fulfill({ status: 204 });
  });
  await openSecurity(page, info);
  await page.getByRole('button', { name: 'Remove Laptop' }).click();
  await expect(page.getByText('No passkeys yet.')).toBeVisible();
  expect(removed).toBe('DELETE');
});

test('the last way to sign in cannot be removed, in words', async ({ page }, info) => {
  await script(page, [[LAPTOP]]);
  await page.route('**/api/passkeys/p1', (route) =>
    route.fulfill({ status: 409, json: { error: 'last_sign_in_method' } }),
  );
  await openSecurity(page, info);
  await page.getByRole('button', { name: 'Remove Laptop' }).click();
  await expect(page.getByRole('alert')).toContainText('only way to sign in');
  await expect(page.getByRole('table', { name: 'Your passkeys' })).toContainText('Laptop');
});

const OPTIONS = {
  challenge: 'AAAAAAAAAAAAAAAAAAAAAA',
  rp: { name: 'Morgan', id: 'localhost' },
  user: { id: 'dXNlci0x', name: 'a@example.test', displayName: 'a@example.test' },
  pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
  authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  attestation: 'none',
};

/** A software authenticator in the browser, so the real creation call runs. */
async function withAuthenticator(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

test('a passkey is made by the browser, sent to the server under its name, and listed', async ({
  page,
}, info) => {
  await withAuthenticator(page);
  let stored: { name: string; response: { id: string; type: string } } | undefined;
  await script(page, [[], [PHONE]], async (route) => {
    stored = route.request().postDataJSON() as typeof stored;
    await route.fulfill({ status: 201, json: { id: 'p2' } });
  });
  await page.route('**/api/passkeys/options', (route) => route.fulfill({ json: OPTIONS }));
  await openSecurity(page, info);
  await page.getByLabel('Name for the new passkey').fill('Phone');
  await page.getByRole('button', { name: 'Add a passkey' }).click();
  await expect(page.getByRole('table', { name: 'Your passkeys' })).toContainText('Phone');
  expect(stored?.name).toBe('Phone');
  expect(stored?.response.type).toBe('public-key');
  expect(stored?.response.id).not.toBe('');
});

test('a person with an authenticator is asked for a code first, then the passkey is added', async ({
  page,
}, info) => {
  await withAuthenticator(page);
  await script(page, [[], [PHONE]], (route) => route.fulfill({ status: 201, json: { id: 'p2' } }));
  const asked: unknown[] = [];
  await page.route('**/api/passkeys/options', (route) => {
    const body = route.request().postDataJSON() as { code?: string };
    asked.push(body);
    return body.code === undefined
      ? route.fulfill({ status: 401, json: { error: 'invalid_code' } })
      : route.fulfill({ json: OPTIONS });
  });
  await openSecurity(page, info);
  await page.getByRole('button', { name: 'Add a passkey' }).click();
  await page.getByLabel('Authenticator or backup code').fill('123456');
  await page.getByRole('button', { name: 'Add a passkey' }).click();
  await expect(page.getByRole('table', { name: 'Your passkeys' })).toContainText('Phone');
  expect(asked).toEqual([{}, { code: '123456' }]);
});

test('a refused passkey is explained, and an install without passkeys says so', async ({
  page,
}, info) => {
  await withAuthenticator(page);
  await script(page, [[]], (route) =>
    route.fulfill({ status: 409, json: { error: 'already_registered' } }),
  );
  let options = 200;
  await page.route('**/api/passkeys/options', (route) =>
    options === 200
      ? route.fulfill({ json: OPTIONS })
      : route.fulfill({ status: options, json: { error: 'passkeys_unavailable' } }),
  );
  await openSecurity(page, info);
  await page.getByRole('button', { name: 'Add a passkey' }).click();
  await expect(page.getByRole('alert')).toContainText('already has a passkey');
  options = 501;
  await page.getByRole('button', { name: 'Add a passkey' }).click();
  await expect(page.getByText('Passkeys are not available on this install.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add a passkey' })).toHaveCount(0);
});

test('a list that cannot be read shows the error and no longer says loading', async ({
  page,
}, info) => {
  await script(page, [[]]);
  await page.route('**/api/passkeys', (route) => route.abort());
  await open(page, queryOf(info.project.metadata));
  await page.getByRole('button', { name: 'Security' }).click();
  await expect(page.getByRole('alert')).toContainText('cannot be reached');
  await expect(page.getByRole('heading', { name: 'Passkeys' })).toBeVisible();
  await expect(page.getByText('Loading.')).toHaveCount(0);
});

test('a refused passkey after a code asks for a fresh code on the next try', async ({
  page,
}, info) => {
  await withAuthenticator(page);
  await script(page, [[]], (route) =>
    route.fulfill({ status: 409, json: { error: 'already_registered' } }),
  );
  await page.route('**/api/passkeys/options', (route) =>
    (route.request().postDataJSON() as { code?: string }).code === undefined
      ? route.fulfill({ status: 401, json: { error: 'invalid_code' } })
      : route.fulfill({ json: OPTIONS }),
  );
  await openSecurity(page, info);
  await page.getByRole('button', { name: 'Add a passkey' }).click();
  await page.getByLabel('Authenticator or backup code').fill('123456');
  await page.getByRole('button', { name: 'Add a passkey' }).click();
  await expect(page.getByRole('alert')).toContainText('already has a passkey');
  await expect(page.getByLabel('Authenticator or backup code')).toHaveCount(0);
});
