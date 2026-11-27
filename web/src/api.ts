// The browser's side of the HTTP API (`/api`). Same origin, JSON only; the session is a cookie.
export type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

export type SignInAnswer = { step: 'second_factor'; challenge: string } | { step?: undefined };

/** Where a person stands: the screen to show. `unknown` means the server could not be asked (retry). */
export type Standing = 'in' | 'out' | 'change' | 'unknown';

const PASSWORD_CHANGE = 'password_change_required';

async function call<T>(path: string, body?: unknown): Promise<Result<T>> {
  const init: RequestInit =
    body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        };
  try {
    const response = await fetch(`/api${path}`, init);
    const text = await response.text();
    const data = (text === '' ? {} : JSON.parse(text)) as Record<string, unknown>;
    const error = typeof data['error'] === 'string' ? data['error'] : 'server_error';
    if (response.ok) return { ok: true, data: data as T };
    return { ok: false, status: response.status, error };
  } catch {
    return { ok: false, status: 0, error: 'network' };
  }
}

export function signIn(email: string, password: string): Promise<Result<SignInAnswer>> {
  return call('/sign-in', { email, password });
}

export function secondFactor(challenge: string, code: string): Promise<Result<unknown>> {
  return call('/sign-in/second-factor', { challenge, code });
}

export function changePassword(
  current: string,
  password: string,
  acceptedNotice: boolean,
): Promise<Result<unknown>> {
  return call('/change-password', { current, password, acceptedNotice });
}

/** Asks the server who this is: signed in, signed out (only a 401), held on the change-password screen, or unknown (network or server trouble). */
export async function standing(): Promise<Standing> {
  const answer = await call('/me');
  if (answer.ok) return 'in';
  if (answer.status === 401) return 'out';
  return answer.error === PASSWORD_CHANGE ? 'change' : 'unknown';
}
