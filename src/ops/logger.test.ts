import { expect, it } from 'vitest';
import { createLogger } from './logger.js';

const SECRETS = {
  anthropic: 'FAKE-anthropic-key-0001',
  telegram: 'FAKE-telegram-token-0002',
  bearer: 'Bearer FAKE-bearer-0003',
  password: 'FAKE-password-0004',
  message: 'FAKE message body: my passport number is 0005',
  dbUrl: 'postgres://user:FAKE-dbpass-0006@db/morgan',
  cookie: 'session=FAKE-cookie-0007',
  accessToken: 'FAKE-access-token-0008',
  botToken: 'FAKE-bot-token-0009',
  xApiKey: 'FAKE-x-api-key-0010',
  setCookie: 'FAKE-set-cookie-0011',
  deep: 'FAKE-deeply-nested-0012',
};

function capture(entry: Record<string, unknown>): string {
  const lines: string[] = [];
  const logger = createLogger('info', {
    write: (line: string) => {
      lines.push(line);
    },
  });
  logger.info(entry, 'request handled');
  return lines.join('');
}

it('prints none of a fixture full of fake secrets', () => {
  const output = capture({
    status: 200,
    apiKey: SECRETS.anthropic,
    token: SECRETS.telegram,
    accessToken: SECRETS.accessToken,
    botToken: SECRETS.botToken,
    req: {
      headers: {
        Authorization: SECRETS.bearer,
        cookie: SECRETS.cookie,
        'X-Api-Key': SECRETS.xApiKey,
      },
    },
    res: { headers: { 'set-cookie': [SECRETS.setCookie] } },
    user: { password: SECRETS.password },
    message: { text: SECRETS.message },
    body: SECRETS.message,
    config: { DATABASE_URL: SECRETS.dbUrl, ANTHROPIC_API_KEY: SECRETS.anthropic },
    level1: { level2: [{ level3: { level4: { PASSWORD: SECRETS.deep } } }] },
  });
  for (const secret of Object.values(SECRETS)) expect(output).not.toContain(secret);
  expect(output).toContain('request handled');
  expect(output).toContain('"status":200');
  expect(output).toContain('[REDACTED]');
});

it('keeps harmless fields', () => {
  expect(capture({ user: { name: 'visible-name' } })).toContain('visible-name');
});
