import { expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

const URL = 'postgres://morgan:pw@localhost:5432/morgan';

it('applies defaults and treats empty values as unset', () => {
  const config = loadConfig({ DATABASE_URL: URL, TELEGRAM_BOT_TOKEN: '' });
  expect(config).toEqual({ DATABASE_URL: URL, PORT: 3000, LOG_LEVEL: 'info' });
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
