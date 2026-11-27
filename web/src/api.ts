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

/** An invite link's one-time token, with the new login and the admin-read notice accepted. */
export function join(
  token: string,
  email: string,
  password: string,
  acceptedNotice: boolean,
): Promise<Result<unknown>> {
  return call('/join', { token, email, password, acceptedNotice });
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

export interface PendingInvite {
  id: string;
  monthlyLimitUsd?: number;
  createdAt: string;
  expiresAt: string;
}

/** The invites nobody has used yet. */
export function listInvites(): Promise<Result<{ invites: PendingInvite[] }>> {
  return call('/admin/invites');
}

/** A new invite; the answer holds its one-time token, which the server never shows again. */
export function createInvite(
  monthlyLimitUsd: number | null,
  ttlHours: number,
): Promise<Result<{ token: string; ttlHours: number }>> {
  return call('/invites', { monthlyLimitUsd, ttlHours });
}

/** A 404 means it was used or revoked meanwhile. */
export function revokeInvite(id: string): Promise<Result<unknown>> {
  return call(`/admin/invites/${encodeURIComponent(id)}`, undefined, 'DELETE');
}

/** A member with a temporary password, shown once in the answer; a 409 email_taken means the email has an account. */
export function createAccount(
  email: string,
  monthlyLimitUsd: number | null,
): Promise<Result<{ temporaryPassword: string }>> {
  return call('/accounts', { email, monthlyLimitUsd });
}

type Preset = 'restricted' | 'standard' | 'trusted';
export type Mode = 'off' | 'ask' | 'auto';

/** What each preset allows, per action type. */
export interface PresetRow {
  preset: Preset;
  modes: Record<string, Mode>;
}

/** The profile that applies to a person, and to each of their chats (`own`: chosen for that chat). */
interface Applied {
  preset: Preset;
  modes: Record<string, Mode>;
}
export interface Profiles {
  person: Applied;
  devices: (Applied & { deviceId: string; channel: string; own: boolean })[];
}

export function listPresets(): Promise<Result<{ presets: PresetRow[] }>> {
  return call('/admin/profile-presets');
}

export function profilesOf(userId: string): Promise<Result<Profiles>> {
  return call(`/members/${encodeURIComponent(userId)}/profiles`);
}

export interface AuditRow {
  id: string;
  at: string;
  personId: string | null;
  person: string | null;
  subjectId: string | null;
  subject: string | null;
  tool: string;
  actionType: string;
  decision: string;
  outcome: string;
  reason: string | null;
}

export interface AuditPage {
  rows: AuditRow[];
  more: boolean;
  /** Every action type in the log, for the filter. */
  actions: string[];
}

/** What to show: empty text means no filter on that field. Dates are `year-month-day`, UTC. */
export interface AuditFilters {
  person: string;
  action: string;
  decision: string;
  outcome: string;
  from: string;
  to: string;
}

const DAY_MS = 86_400_000;

/** One page of the audit log, newest first; `before` is the id of the oldest row already shown. */
export function listAudit(filters: AuditFilters, before?: string): Promise<Result<AuditPage>> {
  const query = new URLSearchParams();
  const { person, action, decision, outcome, from, to } = filters;
  const set = (name: string, value: string) => {
    if (value !== '') query.set(name, value);
  };
  set('person', person);
  set('action', action);
  set('decision', decision);
  set('outcome', outcome);
  set('from', from);
  // The last day counts whole, so the limit is the start of the day after it.
  set('to', to === '' ? '' : new Date(Date.parse(to) + DAY_MS).toISOString());
  if (before !== undefined) query.set('before', before);
  return call(`/admin/audit?${query.toString()}`);
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

export interface BudgetPerson {
  id: string;
  role: string;
  email?: string;
  /** Their own monthly limit; absent when the install default applies. */
  limitUsd?: string;
  taskCap?: number;
  topupStepUsd?: string;
  /** Approved top-ups this month and spend this month: exact decimal strings. */
  topupUsd: string;
  spentUsd: string;
  calls: number;
}

export interface Budgets {
  /** The local month the totals cover, `2026-11`. */
  month: string;
  defaults: { limitUsd: string | null; topupUsd: string | null };
  people: BudgetPerson[];
}

/** Spend this month beside each person's limit; a member gets 403. */
export function listBudgets(): Promise<Result<Budgets>> {
  return call('/admin/budgets');
}

/** The monthly limit in USD as a decimal string (0 pauses them); 404 means the person is not in this workspace. */
export function setBudget(id: string, limitUsd: string): Promise<Result<unknown>> {
  return call(`/admin/people/${encodeURIComponent(id)}/budget`, { limitUsd }, 'PUT');
}

/** How many tasks a person runs at once; `null` goes back to the default. */
export function setTaskCap(id: string, cap: number | null): Promise<Result<unknown>> {
  return call(`/admin/people/${encodeURIComponent(id)}/task-cap`, { cap }, 'PUT');
}

/** What one approved top-up adds for this person; `null` goes back to the install's step. */
export function setTopupStep(id: string, amountUsd: string | null): Promise<Result<unknown>> {
  return call(`/admin/people/${encodeURIComponent(id)}/topup-step`, { amountUsd }, 'PUT');
}

export interface WaitingTopup {
  id: string;
  memberId: string;
  email?: string;
  /** The amount asked for, an exact decimal string. */
  amountUsd: string;
  month: string;
  createdAt: string;
  expiresAt: string;
}

/** The requests for more still waiting for an answer; a member gets 403. */
export function listTopups(): Promise<Result<{ topups: WaitingTopup[] }>> {
  return call('/admin/topups');
}

/** The same question Telegram shows: it counts once, whichever side answers first. A 404 `not_open` means it was answered or lapsed. */
export function answerTopup(
  id: string,
  decision: 'approved' | 'refused',
): Promise<Result<{ amountUsd: string }>> {
  return call(`/admin/topups/${encodeURIComponent(id)}`, { decision });
}
