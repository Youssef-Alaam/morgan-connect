import { afterEach, describe, expect, it, vi } from 'vitest';
import { signIn, standing } from './api.ts';
import { errorKey } from './errors.ts';

function answer(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status }))),
  );
}

function sent(): { path: string; init: RequestInit } {
  const [path, init] = vi.mocked(fetch).mock.calls[0] ?? [];
  return { path: typeof path === 'string' ? path : '', init: init ?? {} };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the account calls', () => {
  it('posts the sign-in as JSON to /api/sign-in', async () => {
    answer(200, { ok: true });
    expect(await signIn('a@example.test', 'pw')).toEqual({ ok: true, data: { ok: true } });
    const { path, init } = sent();
    expect(path).toBe('/api/sign-in');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ email: 'a@example.test', password: 'pw' }));
    expect(init.headers).toEqual({ 'content-type': 'application/json' });
  });

  it('turns an error answer into its status and error word', async () => {
    answer(401, { error: 'invalid_credentials' });
    expect(await signIn('a@example.test', 'bad')).toEqual({
      ok: false,
      status: 401,
      error: 'invalid_credentials',
    });
  });

  it('calls an unreachable server a network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline'))),
    );
    expect(await signIn('a@example.test', 'pw')).toEqual({
      ok: false,
      status: 0,
      error: 'network',
    });
  });

  it('calls an error with no word a server error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('', { status: 500 }))),
    );
    expect(await signIn('a@example.test', 'pw')).toEqual({
      ok: false,
      status: 500,
      error: 'server_error',
    });
  });
});

describe('standing', () => {
  it.each([
    [200, { user: {} }, 'in'],
    [401, { error: 'unauthorized' }, 'out'],
    [403, { error: 'password_change_required' }, 'change'],
    [500, { error: 'server_error' }, 'unknown'],
    [502, {}, 'unknown'],
  ] as const)('is %s -> %s', async (status, body, expected) => {
    answer(status, body);
    expect(await standing()).toBe(expected);
    expect(sent().path).toBe('/api/me');
  });
});

describe('standing when the server cannot be asked', () => {
  it('is unknown on a network failure, never signed out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline'))),
    );
    expect(await standing()).toBe('unknown');
  });
});

describe('errorKey', () => {
  it('maps a known word and falls back for the rest', () => {
    expect(errorKey('too_many_attempts')).toBe('errors.too_many_attempts');
    expect(errorKey('something_new')).toBe('errors.generic');
  });
});
