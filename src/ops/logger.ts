import { pino, type DestinationStream, type Logger } from 'pino';

export type { Logger } from 'pino';

/** Keys whose values are credentials, message text or memory text (STANDARDS section 6). */
const SENSITIVE_KEYS = [
  'password',
  'token',
  'secret',
  'apiKey',
  'api_key',
  'authorization',
  'cookie',
  'body',
  'text',
  'content',
  'memory',
  'DATABASE_URL',
  'databaseUrl',
  'TELEGRAM_BOT_TOKEN',
  'ANTHROPIC_API_KEY',
];

/** Each key is redacted at the top level and one level down. */
const REDACT_PATHS = [
  ...SENSITIVE_KEYS,
  ...SENSITIVE_KEYS.map((key) => `*.${key}`),
  'req.headers.authorization',
  'req.headers.cookie',
  '*.req.headers.authorization',
  '*.req.headers.cookie',
];

export function createLogger(level: string, destination?: DestinationStream): Logger {
  const options = { level, redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } };
  return destination === undefined ? pino(options) : pino(options, destination);
}
