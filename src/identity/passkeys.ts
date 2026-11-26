import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { NewPasskey, Passkey } from '../data/index.js';

/** Where passkeys are valid: the domain and the exact browser origin (config WEBAUTHN_RP_ID, WEBAUTHN_ORIGIN). */
export interface RelyingParty {
  rpId: string;
  origin: string;
}

const RP_NAME = 'Morgan';
const CHALLENGE_MS = 5 * 60 * 1000;
const MAX_CHALLENGES = 1000;

/**
 * Challenges handed out and not yet answered, in memory (a restart drops them; the person tries
 * again). One answer per challenge; a registration challenge belongs to one person and a sign-in
 * challenge to nobody, so neither can stand in for the other.
 */
export interface Challenges {
  put: (challenge: string, userId?: string) => void;
  /** True once for a live challenge that was made for this person (or for nobody). */
  take: (challenge: string, userId?: string) => boolean;
}

export function createChallenges(now: () => number): Challenges {
  const open = new Map<string, { userId: string | undefined; until: number }>();
  return {
    put: (challenge, userId) => {
      for (const [key, entry] of open) if (entry.until <= now()) open.delete(key);
      // Full of live ones: forget the oldest rather than grow without end.
      for (const key of open.keys()) {
        if (open.size < MAX_CHALLENGES) break;
        open.delete(key);
      }
      open.set(challenge, { userId, until: now() + CHALLENGE_MS });
    },
    take: (challenge, userId) => {
      const entry = open.get(challenge);
      open.delete(challenge);
      return entry !== undefined && entry.until > now() && entry.userId === userId;
    },
  };
}

/** The handle an authenticator keeps for a person: their user id, so a sign-in can be checked against it. */
export const userHandle = (userId: string): string => Buffer.from(userId).toString('base64url');

/** What the browser needs to create a passkey for this person; their existing ones are excluded. */
export function registrationOptions(
  rp: RelyingParty,
  person: { userId: string; label: string },
  existing: Passkey[],
) {
  return generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp.rpId,
    userName: person.label,
    userID: new TextEncoder().encode(person.userId),
    attestationType: 'none',
    excludeCredentials: existing.map((each) => ({
      id: each.credentialId,
      ...(each.transports === null ? {} : { transports: each.transports }),
    })),
    // A passkey stands in for the password and the second factor, so it must prove the person (PIN, face, finger).
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
}

/** The passkey to store, or undefined when the browser's answer does not check out. */
export async function verifyRegistration(
  rp: RelyingParty,
  response: RegistrationResponseJSON,
  expected: (challenge: string) => boolean,
): Promise<Omit<NewPasskey, 'name'> | undefined> {
  try {
    const result = await verifyRegistrationResponse({
      response,
      expectedChallenge: expected,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpId,
      requireUserVerification: true,
    });
    if (!result.verified) return undefined;
    const { credential } = result.registrationInfo;
    return {
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter,
      transports: credential.transports,
    };
  } catch {
    return undefined;
  }
}

/** Sign-in options with no person named: the browser offers whichever passkey it holds for this site. */
export const authenticationOptions = (rp: RelyingParty) =>
  generateAuthenticationOptions({ rpID: rp.rpId, userVerification: 'required' });

/** The new signature count when the assertion is genuine for this stored passkey, else undefined. */
export async function verifyAuthentication(
  rp: RelyingParty,
  response: AuthenticationResponseJSON,
  stored: { credentialId: string; publicKey: string; counter: number; transports: string[] | null },
  expected: (challenge: string) => boolean,
): Promise<number | undefined> {
  try {
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: expected,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpId,
      credential: {
        id: stored.credentialId,
        publicKey: Buffer.from(stored.publicKey, 'base64url'),
        counter: stored.counter,
        ...(stored.transports === null ? {} : { transports: stored.transports }),
      },
      requireUserVerification: true,
    });
    return result.verified ? result.authenticationInfo.newCounter : undefined;
  } catch {
    return undefined;
  }
}
