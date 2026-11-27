// The browser's side of the HTTP API (`/api`). Same origin, JSON only; the session is a cookie.
export type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

export type SignInAnswer = { step: 'second_factor'; challenge: string } | { step?: undefined };

/** Where a person stands: the screen to show. `unknown` means the server could not be asked (retry). */
export type Standing = 'in' | 'out' | 'change' | 'unknown';

const PASSWORD_CHANGE = 'password_change_required';

async function call<T>(path: string, body?: unknown, method?: string): Promise<Result<T>> {
  const init: RequestInit =
    body === undefined
      ? method === undefined
        ? {}
        : { method }
      : {
          method: method ?? 'POST',
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

export function setPassword(
  token: string,
  email: string,
  password: string,
): Promise<Result<unknown>> {
  return call('/set-password', { token, email, password });
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

export interface TwoFactorStatus {
  /** False when this install has no key to keep the secret with. */
  available: boolean;
  enabled: boolean;
}

export function twoFactorStatus(): Promise<Result<TwoFactorStatus>> {
  return call('/two-factor');
}

/** The key to type (or open as `uri`) in an authenticator app; nothing is on until `confirmTwoFactor`. */
export function startTwoFactor(): Promise<Result<{ secret: string; uri: string }>> {
  return call('/two-factor/setup', {});
}

/** The first code turns it on; the answer holds the backup codes, shown once and never again. */
export function confirmTwoFactor(code: string): Promise<Result<{ backupCodes: string[] }>> {
  return call('/two-factor/confirm', { code });
}

/** Turning it off takes a current authenticator code or an unused backup code. */
export function disableTwoFactor(code: string): Promise<Result<unknown>> {
  return call('/two-factor/disable', { code });
}

export interface Passkey {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export function listPasskeys(): Promise<Result<Passkey[]>> {
  return call('/passkeys');
}

/**
 * The options for the browser to make a passkey from. A person with an authenticator on gets a 401
 * `invalid_code` until `code` (an authenticator or backup code) is given.
 */
export function passkeyOptions(code?: string): Promise<Result<unknown>> {
  return call('/passkeys/options', code === undefined ? {} : { code });
}

/** Store the passkey the browser made (the JSON form of its answer). */
export function addPasskey(response: object, name: string): Promise<Result<unknown>> {
  return call('/passkeys', { response, name });
}

/** A 409 `last_sign_in_method` means it is the only way this person can sign in. */
export function removePasskey(id: string): Promise<Result<unknown>> {
  return call(`/passkeys/${encodeURIComponent(id)}`, undefined, 'DELETE');
}

/** Who is signed in: the Users page is offered to the admin only (the server decides, too). */
export function whoAmI(): Promise<Result<{ user?: { role?: string } }>> {
  return call('/me');
}

export interface Person {
  id: string;
  role: string;
  email?: string;
  status: 'active' | 'temporary_password';
  createdAt: string;
  devices: { id: string; channel: string; createdAt: string }[];
}

/** Everyone in the workspace with their linked chats; a member gets 403. */
export function listPeople(): Promise<Result<{ people: Person[] }>> {
  return call('/admin/people');
}

/** The admin unlinks a person's chat (the same call a member uses for their own). */
export function unlinkDevice(id: string): Promise<Result<unknown>> {
  return call(`/devices/${encodeURIComponent(id)}`, undefined, 'DELETE');
}

/** Ends this browser's session. */
export function signOut(): Promise<Result<unknown>> {
  return call('/sign-out', {});
}

/** Answer a question Morgan asked. A 409 means it is no longer open (answered, expired or over). */
export function decideApproval(
  id: string,
  decision: 'approved' | 'denied',
): Promise<Result<unknown>> {
  return call(`/chat/approvals/${encodeURIComponent(id)}`, { decision });
}

export function sendMessage(text: string, messageId: string): Promise<Result<unknown>> {
  return call('/chat', { text, messageId });
}
