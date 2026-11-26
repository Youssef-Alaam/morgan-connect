import { expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

const URL = 'postgres://morgan:pw@localhost:5432/morgan';

it('applies defaults and treats empty values as unset', () => {
  const config = loadConfig({ DATABASE_URL: URL, TELEGRAM_BOT_TOKEN: '' });
  expect(config).toEqual({
    DATABASE_URL: URL,
    PORT: 3000,
    LOG_LEVEL: 'info',
    ANTHROPIC_MODEL: 'claude-sonnet-5-5',
    ENGINE: 'pi',
    DEMO_TOOLS: false,
    VAULT_BRANCH: 'main',
    TIMEZONE: 'UTC',
    IDLE_GAP_MINUTES: 360,
    COMPACT_AT_TOKENS: 8000,
  });
});

it('reads DEMO_TOOLS as a switch that is off by default', () => {
  expect(loadConfig({ DATABASE_URL: URL, DEMO_TOOLS: 'true' }).DEMO_TOOLS).toBe(true);
  expect(loadConfig({ DATABASE_URL: URL, DEMO_TOOLS: 'false' }).DEMO_TOOLS).toBe(false);
  expect(() => loadConfig({ DATABASE_URL: URL, DEMO_TOOLS: 'maybe' })).toThrow(/DEMO_TOOLS/);
});

it('takes an IANA TIMEZONE and rejects anything else', () => {
  expect(loadConfig({ DATABASE_URL: URL, TIMEZONE: 'Asia/Riyadh' }).TIMEZONE).toBe('Asia/Riyadh');
  expect(() => loadConfig({ DATABASE_URL: URL, TIMEZONE: 'Mars/Base' })).toThrow(/TIMEZONE/);
});

it('reads IDLE_GAP_MINUTES (default 6 hours) and refuses under 5 minutes', () => {
  expect(loadConfig({ DATABASE_URL: URL, IDLE_GAP_MINUTES: '90' }).IDLE_GAP_MINUTES).toBe(90);
  expect(loadConfig({ DATABASE_URL: URL, IDLE_GAP_MINUTES: '5' }).IDLE_GAP_MINUTES).toBe(5);
  expect(() => loadConfig({ DATABASE_URL: URL, IDLE_GAP_MINUTES: '4' })).toThrow(
    /IDLE_GAP_MINUTES/,
  );
  expect(() => loadConfig({ DATABASE_URL: URL, IDLE_GAP_MINUTES: 'soon' })).toThrow(
    /IDLE_GAP_MINUTES/,
  );
});

it('reads COMPACT_AT_TOKENS (default 8000) and refuses under 1000', () => {
  expect(loadConfig({ DATABASE_URL: URL, COMPACT_AT_TOKENS: '50000' }).COMPACT_AT_TOKENS).toBe(
    50000,
  );
  expect(() => loadConfig({ DATABASE_URL: URL, COMPACT_AT_TOKENS: '999' })).toThrow(
    /COMPACT_AT_TOKENS/,
  );
});

it('reads every key', () => {
  const env = { DATABASE_URL: URL, PORT: '8080', LOG_LEVEL: 'debug', ANTHROPIC_API_KEY: 'k' };
  expect(loadConfig(env)).toMatchObject({ PORT: 8080, LOG_LEVEL: 'debug', ANTHROPIC_API_KEY: 'k' });
});

it('rejects bad config without echoing the values', () => {
  const bad = { DATABASE_URL: 'not-a-url-FAKE-secret', PORT: 'abc' };
  const run = (): unknown => loadConfig(bad);
  expect(run).toThrow(ConfigError);
  expect(run).toThrow(/DATABASE_URL/);
  expect(run).not.toThrow(/FAKE-secret/);
});

it('requires https for TELEGRAM_API_ROOT unless the host is local', () => {
  const root = (value: string): unknown =>
    loadConfig({ DATABASE_URL: URL, TELEGRAM_API_ROOT: value });
  expect(() => root('http://evil.example.com')).toThrow(/TELEGRAM_API_ROOT/);
  expect(() => root('http://localhost:8081')).not.toThrow();
  expect(() => root('http://127.0.0.1:8081')).not.toThrow();
  expect(() => root('https://bot-api.example.com')).not.toThrow();
});

it('lets the model be chosen', () => {
  const config = loadConfig({ DATABASE_URL: URL, ANTHROPIC_MODEL: 'claude-opus-5' });
  expect(config.ANTHROPIC_MODEL).toBe('claude-opus-5');
});

it('needs ENGINE_URL and ENGINE_TOKEN when ENGINE is http, and says which is missing', () => {
  const env = { DATABASE_URL: URL, ENGINE: 'http' };
  expect(() => loadConfig(env)).toThrow(/ENGINE_URL/);
  expect(() => loadConfig({ ...env, ENGINE_URL: 'http://localhost:8787' })).toThrow(/ENGINE_TOKEN/);
  const config = loadConfig({ ...env, ENGINE_URL: 'http://localhost:8787', ENGINE_TOKEN: 't' });
  expect(config).toMatchObject({ ENGINE: 'http', ENGINE_URL: 'http://localhost:8787' });
});

it('sends the engine token only over https or to this machine or the compose host', () => {
  const url = (value: string): unknown =>
    loadConfig({ DATABASE_URL: URL, ENGINE: 'http', ENGINE_URL: value, ENGINE_TOKEN: 't' });
  expect(() => url('http://engine.example.com')).toThrow(/ENGINE_URL/);
  expect(() => url('http://host.docker.internal:8787')).not.toThrow();
  expect(() => url('http://127.0.0.1:8787')).not.toThrow();
  expect(() => url('https://engine.example.com')).not.toThrow();
});

it('refuses an unknown ENGINE', () => {
  expect(() => loadConfig({ DATABASE_URL: URL, ENGINE: 'magic' })).toThrow(/ENGINE/);
});

it('takes an optional owner connection for migrations', () => {
  expect(loadConfig({ DATABASE_URL: URL }).MIGRATION_DATABASE_URL).toBeUndefined();
  const owner = 'postgres://owner:pw@localhost:5432/morgan';
  expect(loadConfig({ DATABASE_URL: URL, MIGRATION_DATABASE_URL: owner })).toMatchObject({
    MIGRATION_DATABASE_URL: owner,
  });
  expect(() => loadConfig({ DATABASE_URL: URL, MIGRATION_DATABASE_URL: 'nope' })).toThrow(
    /MIGRATION_DATABASE_URL/,
  );
});

it('registers the vault only when its URL and token come together', () => {
  const vault = { VAULT_REMOTE_URL: 'https://github.com/o/v.git', VAULT_TOKEN: 'abc' };
  expect(loadConfig({ DATABASE_URL: URL, ...vault })).toMatchObject({
    ...vault,
    VAULT_BRANCH: 'main',
  });
  expect(() => loadConfig({ DATABASE_URL: URL, VAULT_TOKEN: 'abc' })).toThrow(/VAULT_REMOTE_URL/);
  expect(() => loadConfig({ DATABASE_URL: URL, VAULT_REMOTE_URL: vault.VAULT_REMOTE_URL })).toThrow(
    /VAULT_TOKEN/,
  );
});

it('keeps the vault token off http hosts and out of the URL', () => {
  const env = { DATABASE_URL: URL, VAULT_TOKEN: 'abc' };
  const load = (url: string) => () => loadConfig({ ...env, VAULT_REMOTE_URL: url });
  expect(load('http://github.com/o/v.git')).toThrow(/VAULT_REMOTE_URL/);
  expect(load('https://me:secret@github.com/o/v.git')).toThrow(/VAULT_REMOTE_URL/);
  expect(load('http://localhost:9/v.git')).not.toThrow();
  expect(() =>
    loadConfig({ ...env, VAULT_REMOTE_URL: 'https://h/v.git', VAULT_BRANCH: '-x' }),
  ).toThrow(/VAULT_BRANCH/);
});

it('takes TWO_FACTOR_KEY as 32 base64 bytes and refuses anything else, without echoing it', () => {
  const key = Buffer.alloc(32, 7).toString('base64');
  expect(loadConfig({ DATABASE_URL: URL, TWO_FACTOR_KEY: key }).TWO_FACTOR_KEY).toBe(key);
  const short = Buffer.alloc(16, 7).toString('base64');
  const failure = (): unknown => loadConfig({ DATABASE_URL: URL, TWO_FACTOR_KEY: short });
  expect(failure).toThrow(/TWO_FACTOR_KEY/);
  expect(failure).not.toThrow(short);
});
