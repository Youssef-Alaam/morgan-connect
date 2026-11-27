import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { atomicWrite, createLogger } from '../ops/index.js';
import { createApp } from './app.js';

const PAGE = '<!doctype html><title>Morgan</title><div id="root"></div>';
let dir = '';
let outside = '';
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  const base = await mkdtemp(join(tmpdir(), 'web-dist-'));
  outside = join(base, 'secret.txt');
  await atomicWrite(outside, 'secret');
  dir = join(base, 'dist');
  await mkdir(join(dir, 'assets'), { recursive: true });
  await atomicWrite(join(dir, 'index.html'), PAGE);
  await atomicWrite(join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
  await atomicWrite(join(dir, 'favicon.ico'), 'ico');
  await atomicWrite(join(dir, 'blob.bin'), 'x');
  app = createApp({
    dbVersion: () => Promise.resolve('17'),
    logger: createLogger('silent'),
    webDir: dir,
  });
});
afterAll(async () => {
  await rm(join(dir, '..'), { recursive: true, force: true });
});

describe('the web app', () => {
  it.each(['/', '/set-password', '/chats/42'])(
    'serves index.html for the page %s',
    async (path) => {
      const response = await app.request(path);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(PAGE);
      expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(response.headers.get('cache-control')).toBe('no-cache');
    },
  );

  it('serves a built asset as it is, cached for a year', async () => {
    const response = await app.request('/assets/app-abc123.js');
    expect(await response.text()).toBe('console.log(1)');
    expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  it('serves other files for a day, and an unknown type as bytes', async () => {
    const icon = await app.request('/favicon.ico');
    expect(icon.headers.get('cache-control')).toBe('public, max-age=86400');
    expect((await app.request('/blob.bin')).headers.get('content-type')).toBe(
      'application/octet-stream',
    );
  });

  it('sets the security headers', async () => {
    const response = await app.request('/set-password');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("script-src 'unsafe-inline'");
  });

  it('answers a missing file with a 404, not the page', async () => {
    const response = await app.request('/assets/missing.js');
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('Morgan');
  });

  it.each(['/api/unknown', '/api', '/health/x'])('keeps %s a JSON 404', async (path) => {
    const response = await app.request(path);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
  });

  it('still answers /health from the API', async () => {
    expect((await app.request('/health')).status).toBe(200);
  });

  it.each(['/../secret.txt', '/%2e%2e/secret.txt', '/assets/../../secret.txt', '/%zz'])(
    'does not serve a file outside the folder (%s)',
    async (path) => {
      const response = await app.request(path);
      expect(await response.text()).not.toContain('secret');
    },
  );

  it('is off when no folder is set', async () => {
    const bare = createApp({
      dbVersion: () => Promise.resolve('17'),
      logger: createLogger('silent'),
    });
    expect((await bare.request('/set-password')).status).toBe(404);
  });
});
