import { z } from 'zod';

const schema = z
  .object({
    // The app's connection. With MIGRATION_DATABASE_URL set, this role may only INSERT and SELECT on audit_log.
    DATABASE_URL: z.url(),
    // The owner role that runs migrations and sets up the app role. Unset: one role does both (warned).
    MIGRATION_DATABASE_URL: z.url().optional(),
    // Where people reach this install in a browser; the first-password link starts with it. Default: http://localhost:PORT.
    PUBLIC_URL: z.url().optional(),
    // Encrypts authenticator secrets and keys the backup-code hashes: 32 random bytes, base64. Unset: no second factor. Never logged.
    TWO_FACTOR_KEY: z
      .string()
      .refine((value) => Buffer.from(value, 'base64').length === 32, 'must be 32 bytes, base64')
      .optional(),
    // Passkeys: the relying-party id (a domain) and the exact browser origin people sign in at. Set both or neither.
    WEBAUTHN_RP_ID: z.string().min(1).optional(),
    WEBAUTHN_ORIGIN: z.url().optional(),
    PORT: z.coerce.number().int().min(0).max(65535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    // Optional until the tickets that use them land.
    TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
    // A self-hosted Bot API server, or a test double. Default: api.telegram.org.
    // This host receives the bot token, so it must be https unless it is the local machine.
    TELEGRAM_API_ROOT: z
      .url()
      .refine((value) => {
        const { protocol, hostname } = new URL(value);
        return protocol === 'https:' || hostname === 'localhost' || hostname === '127.0.0.1';
      }, 'must be https unless the host is localhost or 127.0.0.1')
      .optional(),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    // The Claude model that answers. Any id in Pi's Anthropic catalog.
    ANTHROPIC_MODEL: z.string().min(1).default('claude-sonnet-5-5'),
    // Which engine answers: Pi with an Anthropic key (default), or an engine you host yourself over HTTP.
    ENGINE: z.enum(['pi', 'http']).default('pi'),
    // Where the HTTP engine listens. It receives ENGINE_TOKEN, so it must be https unless it is this machine.
    ENGINE_URL: z
      .url()
      .refine((value) => {
        const { protocol, hostname } = new URL(value);
        return (
          protocol === 'https:' ||
          ['localhost', '127.0.0.1', 'host.docker.internal'].includes(hostname)
        );
      }, 'must be https unless the host is localhost, 127.0.0.1 or host.docker.internal')
      .optional(),
    // Shared secret for the HTTP engine, sent in a header. Never logged.
    ENGINE_TOKEN: z.string().min(1).optional(),
    // Adds a harmless `demo.gated` tool that always asks for approval, to try the Approve and Deny buttons.
    DEMO_TOOLS: z.stringbool().default(false),
    // The vault repository that `vault.capture` writes to. Set the URL and the token together, or neither.
    // The token is sent to this host, so the URL must be https unless it is this machine.
    VAULT_REMOTE_URL: z
      .url()
      .refine((value) => {
        const { protocol, hostname, username, password } = new URL(value);
        const local = ['localhost', '127.0.0.1'].includes(hostname);
        return (protocol === 'https:' || local) && username === '' && password === '';
      }, 'must be https (or localhost) and must not contain a login')
      .optional(),
    // A fine-grained token with write access to that one repository. Never logged.
    VAULT_TOKEN: z.string().min(1).optional(),
    VAULT_BRANCH: z
      .string()
      .regex(/^[w][w./-]*$/, 'must be a plain branch name')
      .default('main'),
    // Where Morgan keeps its own clone of the vault. Default: a folder in the system temp directory.
    VAULT_DIR: z.string().min(1).optional(),
    // Where "today" and "this month" start in /usage. An IANA name such as UTC or Asia/Riyadh.
    TIMEZONE: z
      .string()
      .min(1)
      .refine((name) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: name });
          return true;
        } catch {
          return false;
        }
      }, 'must be an IANA time zone name')
      .default('UTC'),
    // After this many idle minutes the next message starts a new conversation, as if the person had typed /new.
    IDLE_GAP_MINUTES: z.coerce.number().int().min(5).default(360),
    // When one model call carries this many tokens, the older part of the chat is summarised.
    COMPACT_AT_TOKENS: z.coerce.number().int().min(1000).default(8000),
  })
  .superRefine((value, ctx) => {
    const need = (
      keys: ('ENGINE_URL' | 'ENGINE_TOKEN' | 'VAULT_REMOTE_URL' | 'VAULT_TOKEN')[],
      why: string,
    ) => {
      for (const key of keys) {
        if (value[key] === undefined) ctx.addIssue({ code: 'custom', path: [key], message: why });
      }
    };
    if (value.ENGINE === 'http')
      need(['ENGINE_URL', 'ENGINE_TOKEN'], 'required when ENGINE is http');
    passkeyIssues(value, ctx);
    if (value.VAULT_REMOTE_URL !== undefined || value.VAULT_TOKEN !== undefined) {
      need(['VAULT_REMOTE_URL', 'VAULT_TOKEN'], 'set VAULT_REMOTE_URL and VAULT_TOKEN together');
    }
  });

interface PasskeyConfig {
  WEBAUTHN_RP_ID?: string | undefined;
  WEBAUTHN_ORIGIN?: string | undefined;
}

/** Both or neither, and the origin must sit on the relying-party id: a mismatch fails at boot, not at first sign-in. */
function passkeyIssues(value: PasskeyConfig, ctx: z.RefinementCtx): void {
  const { WEBAUTHN_RP_ID: rpId, WEBAUTHN_ORIGIN: origin } = value;
  if (rpId === undefined && origin === undefined) return;
  const add = (key: string, message: string) => {
    ctx.addIssue({ code: 'custom', path: [key], message });
  };
  if (rpId === undefined || origin === undefined) {
    add('WEBAUTHN_RP_ID', 'set WEBAUTHN_RP_ID and WEBAUTHN_ORIGIN together');
    return;
  }
  const { protocol, hostname } = new URL(origin);
  if (protocol !== 'https:' && hostname !== 'localhost') {
    add('WEBAUTHN_ORIGIN', 'must be https unless the host is localhost');
  }
  if (hostname !== rpId && !hostname.endsWith(`.${rpId}`)) {
    add('WEBAUTHN_ORIGIN', 'host must be WEBAUTHN_RP_ID or a subdomain of it');
  }
}

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
