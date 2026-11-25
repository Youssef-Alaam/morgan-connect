import { expect, it } from 'vitest';
import { createClockTool } from './clock.js';

const now = () => new Date('2026-11-25T10:30:00Z');
const tool = createClockTool({ now });

it('is a harmless read', () => {
  expect(tool).toMatchObject({ name: 'clock.now', actionType: 'read', changesState: false });
});
it('answers in UTC when no zone is configured', async () => {
  const answer = await tool.run({});
  expect(answer).toContain('Wed 25 Nov 2026');
  expect(answer).toContain('10:30:00 (UTC, UTC+00:00)');
  expect(answer).toContain('2026-11-25T10:30:00.000Z (UTC)');
});
it('answers in the configured zone, with its offset', async () => {
  const riyadh = createClockTool({ now, timezone: 'Asia/Riyadh' });
  expect(await riyadh.run({})).toContain('13:30:00 (Asia/Riyadh, UTC+03:00)');
  expect(riyadh.description).toContain('Asia/Riyadh');
});
it('follows daylight saving in the configured zone', async () => {
  const summer = createClockTool({
    now: () => new Date('2026-07-01T10:00:00Z'),
    timezone: 'Europe/London',
  });
  expect(await summer.run({})).toContain('11:00:00 (Europe/London, UTC+01:00)');
});
it('answers in a zone the model names', async () => {
  expect(await tool.run({ timezone: 'Asia/Riyadh' })).toContain('13:30:00 (Asia/Riyadh');
});
it('says so for an unknown zone', async () => {
  expect(await tool.run({ timezone: 'Mars/Base' })).toContain('Unknown time zone');
});
it('uses the real clock when none is given', async () => {
  expect(await createClockTool().run({})).toMatch(/\(UTC\)$/);
});
