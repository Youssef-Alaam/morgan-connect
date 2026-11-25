import type { ToolDefinition } from './registry.js';

/** "What time is it": the harmless first tool. The clock is a parameter so tests can fix it. */
export function createClockTool(now: () => Date = () => new Date()): ToolDefinition {
  return {
    name: 'clock.now',
    description:
      'Get the current date and time. Optionally in an IANA time zone, e.g. Asia/Riyadh.',
    parameters: {
      type: 'object',
      properties: { timezone: { type: 'string', description: 'IANA time zone name' } },
    },
    actionType: 'read',
    changesState: false,
    run: (args) => {
      const date = now();
      const zone = typeof args['timezone'] === 'string' ? args['timezone'] : undefined;
      if (zone === undefined) return Promise.resolve(`${date.toISOString()} (UTC)`);
      try {
        const local = date.toLocaleString('en-GB', { timeZone: zone, hourCycle: 'h23' });
        return Promise.resolve(`${local} (${zone}); ${date.toISOString()} (UTC)`);
      } catch {
        return Promise.resolve(`Unknown time zone "${zone.slice(0, 40)}". Use an IANA name.`);
      }
    },
  };
}
