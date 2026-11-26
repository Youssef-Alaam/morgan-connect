import { createHash } from 'node:crypto';

/** JSON with object keys sorted, so the same arguments in any key order give the same text. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`);
    return `{${entries.join(',')}}`;
  }
  return value === undefined ? 'undefined' : JSON.stringify(value);
}

/** What an approval is bound to: the tool and its exact arguments. Any change gives another hash. */
export const approvalHash = (tool: string, args: Record<string, unknown>): string =>
  createHash('sha256')
    .update(canonical([tool, args]))
    .digest('hex');
