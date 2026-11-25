import { pino, type DestinationStream, type Logger } from 'pino';

export type { Logger } from 'pino';

const CENSOR = '[REDACTED]';
const MAX_DEPTH = 12;

/** Key names, ignoring case, hyphens and underscores, that are always redacted. */
const EXACT_KEYS = new Set(['body', 'text', 'content', 'memory', 'databaseurl']);
/** Any key that ends with one of these is redacted: accessToken, x-api-key, set-cookie... */
const KEY_SUFFIXES = ['token', 'secret', 'password', 'apikey', 'authorization', 'cookie'];

function isSensitive(key: string): boolean {
  const name = key.toLowerCase().replace(/[-_]/g, '');
  return EXACT_KEYS.has(name) || KEY_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype
  );
}

/** Copy `value` with every sensitive key's value replaced, at any depth. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return CENSOR;
  if (Array.isArray(value)) return value.map((item: unknown) => redact(item, depth + 1));
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      isSensitive(key) ? CENSOR : redact(item, depth + 1),
    ]),
  );
}

export function createLogger(level: string, destination?: DestinationStream): Logger {
  const options = {
    level,
    formatters: {
      log: (object: Record<string, unknown>) => redact(object) as Record<string, unknown>,
    },
  };
  return destination === undefined ? pino(options) : pino(options, destination);
}
