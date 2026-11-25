/** "UTC+03:00" for a zone at a moment (the offset changes with daylight saving). */
function utcOffset(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, timeZoneName: 'longOffset' });
  const name = parts.formatToParts(date).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  return name === 'GMT' ? 'UTC+00:00' : name.replace('GMT', 'UTC');
}

/**
 * "Wed 25 Nov 2026 13:30 (Asia/Riyadh, UTC+03:00)": the minute, or the second too. The same shape
 * in every runtime, whatever the locale data says. Throws on an unknown zone.
 */
export function formatLocalTime(date: Date, timeZone: string, withSeconds = false): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  const day = `${part('weekday')} ${part('day')} ${part('month')} ${part('year')}`;
  const clock = `${part('hour')}:${part('minute')}${withSeconds ? `:${part('second')}` : ''}`;
  return `${day} ${clock} (${timeZone}, ${utcOffset(date, timeZone)})`;
}
