import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.url(),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // Optional until the tickets that use them land.
  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
});

export type Config = z.infer<typeof schema>;

/** Thrown when the environment does not match the schema. Lists keys, never values. */
export class ConfigError extends Error {
  readonly kind = 'config_invalid';
  constructor(problems: string[]) {
    super(`Invalid configuration: ${problems.join('; ')}`);
  }
}

/** Parse and check the environment. Empty values count as unset. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const present = Object.entries(env).filter(([, value]) => value !== undefined && value !== '');
  const result = schema.safeParse(Object.fromEntries(present));
  if (!result.success) {
    throw new ConfigError(result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  return result.data;
}
