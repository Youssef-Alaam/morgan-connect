import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  changePassword,
  createInvite,
  decideApproval,
  listPasskeys,
  listInvites,
  revokeInvite,
  removePasskey,
  secondFactor,
  signIn,
  signOut,
  standing,
} from './api.ts';
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

  it('passes a second-factor challenge back with the code', async () => {
    answer(200, { ok: true });
    await secondFactor('c1', '123456');
    expect(sent().path).toBe('/api/sign-in/second-factor');
    expect(sent().init.body).toBe(JSON.stringify({ challenge: 'c1', code: '123456' }));
  });

  it('sends the notice flag with a password change', async () => {
    answer(200, { ok: true });
    await changePassword('old', 'new-password-12', true);
    expect(sent().path).toBe('/api/change-password');
    expect(sent().init.body).toBe(
      JSON.stringify({ current: 'old', password: 'new-password-12', acceptedNotice: true }),
    );
  });

  it('posts the sign-out and accepts the empty answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
    );
    expect(await signOut()).toEqual({ ok: true, data: {} });
    expect(sent().path).toBe('/api/sign-out');
    expect(sent().init.method).toBe('POST');
  });

  it('posts the answer to a question under its id', async () => {
    answer(409, { error: 'not_open' });
    expect(await decideApproval('q-1', 'denied')).toEqual({
      ok: false,
      status: 409,
      error: 'not_open',
    });
    expect(sent().path).toBe('/api/chat/approvals/q-1');
    expect(sent().init.body).toBe(JSON.stringify({ decision: 'denied' }));
  });

  it('encodes the id of the question into the path', async () => {
    answer(200, { ok: true });
    await decideApproval('a/b?c', 'approved');
    expect(sent().path).toBe('/api/chat/approvals/a%2Fb%3Fc');
  });

  it('lists passkeys with a plain GET and removes one with DELETE', async () => {
    answer(200, [{ id: 'p1', name: 'Laptop', createdAt: 'x', lastUsedAt: null }]);
    expect((await listPasskeys()).ok).toBe(true);
    expect(sent().path).toBe('/api/passkeys');
    expect(sent().init).toEqual({});
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
    );
    expect(await removePasskey('p1')).toEqual({ ok: true, data: {} });
    expect(sent().path).toBe('/api/passkeys/p1');
    expect(sent().init).toEqual({ method: 'DELETE' });
    await removePasskey('a/b');
    expect(vi.mocked(fetch).mock.calls[1]?.[0]).toBe('/api/passkeys/a%2Fb');
  });

  it('makes invites, lists and revokes open invites', async () => {
    answer(200, { token: 't', ttlHours: 72 });
    await createInvite(5, 72);
    expect(sent().path).toBe('/api/invites');
    expect(sent().init.body).toBe(JSON.stringify({ monthlyLimitUsd: 5, ttlHours: 72 }));
    answer(200, { invites: [] });
    await listInvites();
    expect(sent().path).toBe('/api/admin/invites');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
    );
    await revokeInvite('a/b');
    expect(sent().path).toBe('/api/admin/invites/a%2Fb');
    expect(sent().init).toEqual({ method: 'DELETE' });
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
    expect(errorKey('same_password')).toBe('errors.same_password');
    expect(errorKey('notice_required')).toBe('errors.notice_required');
    expect(errorKey('something_new')).toBe('errors.generic');
  });
});
