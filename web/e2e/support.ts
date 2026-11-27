import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

// What the scripted-API specs share (page.route): the project's query, opening the page, the
// accessibility check, and one event of the live stream.
export const queryOf = (metadata: unknown): string =>
  typeof metadata === 'object' && metadata !== null && 'query' in metadata
    ? String(metadata.query)
    : '';

export async function open(page: Page, query: string): Promise<void> {
  await page.goto(`/${query}`);
  await page.evaluate(() => document.fonts.ready);
}

/**
 * Load the mono face now and wait for it. A face loads only when text first uses it, so text that
 * appears after a click is drawn in the fallback font until then: the screenshot would depend on
 * how fast the machine is.
 */
export async function monoReady(page: Page): Promise<void> {
  await page.evaluate(() =>
    document.fonts.load("16px 'Space Mono'").then(() => document.fonts.ready),
  );
}

export async function noViolations(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(result.violations).toEqual([]);
}

export const sse = (id: number, kind: string, data: object): string =>
  `id: ${String(id)}\nevent: ${kind}\ndata: ${JSON.stringify(data)}\n\n`;

/** A signed-in browser whose stream is quiet. */
export async function signedIn(page: Page): Promise<void> {
  await page.route('**/api/me', (route) => route.fulfill({ status: 200, json: {} }));
  await page.route('**/api/chat/events', (route) =>
    route.fulfill({ contentType: 'text/event-stream', body: 'retry: 60000\n\n' }),
  );
}
