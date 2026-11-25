import { expect, it } from 'vitest';
import { createLogger } from '../ops/index.js';
import { createApp } from './app.js';

const logger = createLogger('silent');

it('answers /health with the database version', async () => {
  const app = createApp({ dbVersion: () => Promise.resolve('17.1'), logger });
  const response = await app.request('/health');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok', db: '17.1' });
});

it('answers 503 when the database is down', async () => {
  const app = createApp({ dbVersion: () => Promise.reject(new Error('down')), logger });
  const response = await app.request('/health');
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ status: 'error' });
});
