import { expect, it } from 'vitest';
import { createClockTool } from './clock.js';

const tool = createClockTool(() => new Date('2026-11-25T10:30:00Z'));

it('is a harmless read', () => {
  expect(tool).toMatchObject({ name: 'clock.now', actionType: 'read', changesState: false });
});
it('answers in UTC by default', async () => {
  expect(await tool.run({})).toBe('2026-11-25T10:30:00.000Z (UTC)');
});
it('answers in a named zone', async () => {
  expect(await tool.run({ timezone: 'Asia/Riyadh' })).toContain('13:30:00 (Asia/Riyadh)');
});
it('says so for an unknown zone', async () => {
  expect(await tool.run({ timezone: 'Mars/Base' })).toContain('Unknown time zone');
});
it('uses the real clock when none is given', async () => {
  expect(await createClockTool().run({})).toMatch(/^\d{4}-\d\d-\d\dT.*Z \(UTC\)$/);
});
