import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { expect, it } from 'vitest';
import {
  authenticationOptions,
  registrationOptions,
  userHandle,
  verifyAuthentication,
  verifyRegistration,
  type RelyingParty,
} from '../../src/identity/passkeys.js';
import { newAuthenticator } from '../helpers/passkey-authenticator.js';

const RP: RelyingParty = { rpId: 'example.test', origin: 'https://app.example.test' };
const person = { userId: '2b0f5a3e-6c2d-4b53-9a52-3f3f1d2f6a11', label: 'a@example.test' };
const elsewhere = { rpId: 'evil.test', origin: 'https://evil.test' };

/** Register a fresh authenticator the way the endpoints will; returns it with what would be stored. */
async function registered(options: { userVerified?: boolean } = {}) {
  const authenticator = newAuthenticator(RP, options);
  const asked = await registrationOptions(RP, person, []);
  const response = authenticator.create(asked) as RegistrationResponseJSON;
  const stored = await verifyRegistration(RP, response, (given) => given === asked.challenge);
  return { authenticator, asked, response, stored };
}

it('registers a passkey made for this site, and keeps the id, key and count to store', async () => {
  const { authenticator, stored } = await registered();
  expect(stored).toMatchObject({
    credentialId: authenticator.credentialId,
    counter: 0,
    transports: ['internal'],
  });
  expect(stored?.publicKey.length).toBeGreaterThan(40);
});

it('asks for a passkey that proves the person, and leaves out those already held', async () => {
  const held = [
    { credentialId: 'one', transports: ['usb'] },
    { credentialId: 'two', transports: null },
  ];
  const asked = await registrationOptions(RP, person, held as never);
  expect(asked.authenticatorSelection).toMatchObject({
    residentKey: 'required',
    userVerification: 'required',
  });
  expect(asked.excludeCredentials?.map((each) => each.id)).toEqual(['one', 'two']);
  expect(asked.rp.id).toBe(RP.rpId);
});

it('refuses a registration for another site, another challenge, or without proof of the person', async () => {
  const { response, asked } = await registered();
  const check = (given: RegistrationResponseJSON, rp: RelyingParty, challenge = asked.challenge) =>
    verifyRegistration(rp, given, (value) => value === challenge);
  expect(await check(response, elsewhere)).toBeUndefined();
  expect(await check(response, RP, 'another-challenge')).toBeUndefined();
  expect(
    await check({ ...response, response: { ...response.response, attestationObject: 'x' } }, RP),
  ).toBeUndefined();
  expect((await registered({ userVerified: false })).stored).toBeUndefined();
});

/** A stored passkey and a sign-in answer from its authenticator. */
async function signIn(handle?: string) {
  const { authenticator, stored } = await registered();
  const asked = await authenticationOptions(RP);
  const response = authenticator.get(asked, RP, handle) as AuthenticationResponseJSON;
  if (stored === undefined) throw new Error('not registered');
  const record = {
    ...stored,
    credentialId: authenticator.credentialId,
    transports: null as string[] | null,
  };
  return { authenticator, asked, response, record };
}

it('accepts a sign-in from the registered key and returns the new signature count', async () => {
  const { asked, response, record } = await signIn(userHandle(person.userId));
  expect(
    await verifyAuthentication(RP, response, record, (given) => given === asked.challenge),
  ).toBe(1);
  expect(response.response.userHandle).toBe(userHandle(person.userId));
});

it('refuses a sign-in with another key, another site, another challenge or a replayed count', async () => {
  const { authenticator, asked, response, record } = await signIn();
  const verify = (given: AuthenticationResponseJSON, rp = RP, stored = record) =>
    verifyAuthentication(rp, given, stored, (value) => value === asked.challenge);
  const stranger = newAuthenticator(RP).get(asked, RP) as AuthenticationResponseJSON;
  const forged = { ...stranger, id: authenticator.credentialId, rawId: authenticator.credentialId };
  expect(await verify(forged)).toBeUndefined();
  expect(await verify(response, elsewhere)).toBeUndefined();
  expect(await verifyAuthentication(RP, response, record, () => false)).toBeUndefined();
  expect(await verify(response, RP, { ...record, counter: 1 })).toBeUndefined();
  expect(await verify(response, RP, { ...record, transports: ['usb'] })).toBe(1);
});
