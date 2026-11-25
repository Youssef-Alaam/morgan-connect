import type { UsageReport, UsageTotals } from '../data/index.js';

const count = (n: number): string => n.toLocaleString('en-US');

/** Round a non-negative decimal string to `places` by decimal arithmetic (half up), never a float. */
export function roundDecimal(value: string, places: number): string {
  const [whole = '0', fraction = ''] = value.split('.');
  const scale = Math.max(fraction.length, places) - places;
  const unit = 10n ** BigInt(scale);
  const scaled = BigInt(whole + fraction.padEnd(places, '0')) + unit / 2n;
  const digits = (scaled / unit).toString().padStart(places + 1, '0');
  return `${digits.slice(0, digits.length - places)}.${digits.slice(digits.length - places)}`;
}

function line(label: string, t: UsageTotals): string {
  const calls = `${count(t.calls)} ${t.calls === 1 ? 'call' : 'calls'}`;
  const tokens = `${count(t.inputTokens)} tokens in, ${count(t.outputTokens)} out`;
  return `${label}: $${roundDecimal(t.costUsd, 4)}, ${calls}, ${tokens}`;
}

/** The `/usage` reply. */
export function formatUsage(report: UsageReport, timezone: string): string {
  return [
    `Usage (${timezone})`,
    line('Today', report.today),
    line('This month', report.month),
  ].join('\n');
}
