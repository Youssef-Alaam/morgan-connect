import { formatLocalTime } from '../ops/index.js';
import type { ToolDefinition } from './registry.js';

export interface ClockOptions {
  /** A parameter so tests can fix the clock. */
  now?: () => Date;
  /** The zone to answer in unless the model names another (the TIMEZONE setting). */
  timezone?: string;
}

/**
 * "What time is it": the harmless first tool. Its answer is stored in the chat history as the tool
 * returned it, so a tool that returns anything private must think about that before it is added.
 */
export function createClockTool({
  now = () => new Date(),
  timezone = 'UTC',
}: ClockOptions = {}): ToolDefinition {
  return {
    name: 'clock.now',
    description: `Get the current date and time. Defaults to ${timezone}; optionally another IANA time zone, e.g. Asia/Riyadh.`,
    parameters: {
      type: 'object',
      properties: { timezone: { type: 'string', description: 'IANA time zone name' } },
    },
    actionType: 'read',
    changesState: false,
    run: (args) => {
      const date = now();
      const zone = typeof args['timezone'] === 'string' ? args['timezone'] : timezone;
      try {
        return Promise.resolve(`${formatLocalTime(date, zone, true)}; ${date.toISOString()} (UTC)`);
      } catch {
        return Promise.resolve(`Unknown time zone "${zone.slice(0, 40)}". Use an IANA name.`);
      }
    },
  };
}
