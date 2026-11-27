// The browser's part of adding a passkey: the authenticator (PIN, face, finger or a key) makes it.

/** True when this browser can make passkeys at all. */
export const passkeysSupported = (): boolean =>
  typeof PublicKeyCredential !== 'undefined' &&
  typeof PublicKeyCredential.parseCreationOptionsFromJSON === 'function';

/**
 * Ask the browser to make a passkey from the server's options (the JSON form of the creation
 * options). Returns what the server needs to store it, or undefined when none was made: the person
 * cancelled, the browser refused, or it cannot.
 */
export async function createPasskey(options: unknown): Promise<object | undefined> {
  if (!passkeysSupported()) return undefined;
  try {
    const publicKey = PublicKeyCredential.parseCreationOptionsFromJSON(
      options as PublicKeyCredentialCreationOptionsJSON,
    );
    const made = await navigator.credentials.create({ publicKey });
    return made instanceof PublicKeyCredential ? made.toJSON() : undefined;
  } catch {
    return undefined;
  }
}
