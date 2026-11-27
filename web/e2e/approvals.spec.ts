import { expect, test, type Page } from '@playwright/test';
import { noViolations, open, queryOf, signedIn, sse } from './support.ts';

// The approval card in the chat, against a scripted API.

const QUESTION_ID = '5b0c1c1e-3f4a-4c55-9d6e-0a1b2c3d4e5f';
const QUESTION =
  'Morgan wants to use notes.create (create) with these arguments:\n{\n  "title": "Pay the plumber",\n  "amount": 40\n}';

/** The stream shows one question (and, when given, how it ended); `answers` collects the posted decisions. */
async function askQuestion(
  page: Page,
  query: string,
  reply: { status: number; json: object },
  ended?: string,
): Promise<string[]> {
  await signedIn(page);
  const answers: string[] = [];
  await page.route(`**/api/chat/approvals/${QUESTION_ID}`, async (route) => {
    answers.push((route.request().postDataJSON() as { decision: string }).decision);
    await route.fulfill(reply);
  });
  await page.route('**/api/chat/events', (route) =>
    route.fulfill({
      contentType: 'text/event-stream',
      body:
        'retry: 60000\n\n' +
        sse(1, 'approval', { ref: QUESTION_ID, text: QUESTION }) +
        (ended === undefined ? '' : sse(2, 'approval_closed', { ref: QUESTION_ID, text: ended })),
    }),
  );
  await open(page, query);
  return answers;
}

test('an approval card shows the exact arguments, and Approve answers once', async ({
  page,
}, info) => {
  const answers = await askQuestion(page, queryOf(info.project.metadata), {
    status: 200,
    json: { ok: true },
  });
  const card = page.getByRole('group', { name: 'Morgan asks your approval' });
  await expect(card).toContainText('Morgan wants to use notes.create (create)');
  await expect(card.locator('pre')).toHaveText(QUESTION.slice(QUESTION.indexOf('\n') + 1));
  await expect(page.getByRole('log', { name: 'Conversation' })).toHaveScreenshot(
    'chat-approval.png',
  );
  await noViolations(page);
  await card.getByRole('button', { name: 'Approve' }).dblclick();
  await expect(card.getByText('Approved')).toBeVisible();
  await expect(card.getByRole('button')).toHaveCount(0);
  expect(answers).toEqual(['approved']);
});

test('Deny tells the server no', async ({ page }, info) => {
  const answers = await askQuestion(page, queryOf(info.project.metadata), {
    status: 200,
    json: { ok: true },
  });
  await page.getByRole('button', { name: 'Deny' }).click();
  await expect(page.getByText('Denied')).toBeVisible();
  expect(answers).toEqual(['denied']);
});

test('a question that is no longer open says so', async ({ page }, info) => {
  await askQuestion(page, queryOf(info.project.metadata), {
    status: 409,
    json: { error: 'not_open' },
  });
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('No longer valid')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
});

test('a failed answer brings the buttons back with the error', async ({ page }, info) => {
  await askQuestion(page, queryOf(info.project.metadata), {
    status: 500,
    json: { error: 'server_error' },
  });
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('alert')).toContainText('Something went wrong');
  await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible();
});

test('a question that ended while away is shown settled after a reload', async ({ page }, info) => {
  await askQuestion(page, queryOf(info.project.metadata), { status: 409, json: {} }, 'expired');
  await expect(page.getByText('Expired, nothing was done')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
});
