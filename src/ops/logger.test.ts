import { expect, it } from 'vitest';
import { createLogger } from './logger.js';

const SECRETS = [
  'FAKE-anthropic-key-0001',
  'FAKE-telegram-token-0002',
  'Bearer FAKE-bearer-0003',
  'FAKE-password-0004',
  'FAKE message body: my passport number is 0005',
  'postgres://user:FAKE-dbpass-0006@db/morgan',
  'session=FAKE-cookie-0007',
];

it('prints none of a fixture full of fake secrets', () => {
  const lines: string[] = [];
  const logger = createLogger('info', {
    write: (line: string) => {
      lines.push(line);
    },
  });
  logger.info(
    {
      status: 200,
      apiKey: SECRETS[0],
      token: SECRETS[1],
      req: { headers: { authorization: SECRETS[2], cookie: SECRETS[6] } },
      user: { password: SECRETS[3] },
      message: { text: SECRETS[4] },
      body: SECRETS[4],
      config: { DATABASE_URL: SECRETS[5], ANTHROPIC_API_KEY: SECRETS[0] },
    },
    'request handled',
  );
  const output = lines.join('');
  for (const secret of SECRETS) expect(output).not.toContain(secret);
  expect(output).toContain('request handled');
  expect(output).toContain('"status":200');
  expect(output).toContain('[REDACTED]');
});
