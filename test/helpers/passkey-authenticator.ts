import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

/** A software WebAuthn authenticator (ES256, no attestation) that answers like a browser would. */

type Cbor = number | string | Buffer | Cbor[] | Map<number | string, Cbor>;

/** The few CBOR shapes a registration needs: small ints, byte and text strings, maps. */
function cbor(value: Cbor): Buffer {
  const head = (major: number, n: number): Buffer =>
    n < 24
      ? Buffer.from([(major << 5) | n])
      : n < 256
        ? Buffer.from([(major << 5) | 24, n])
        : Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === 'string')
    return Buffer.concat([head(3, Buffer.byteLength(value)), Buffer.from(value)]);
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  if (Array.isArray(value)) return Buffer.concat([head(4, value.length), ...value.map(cbor)]);
  const parts = [...value].flatMap(([key, each]) => [cbor(key), cbor(each)]);
  return Buffer.concat([head(5, value.size), ...parts]);
}

const sha256 = (data: Buffer | string): Buffer => createHash('sha256').update(data).digest();
const b64 = (data: Buffer): string => data.toString('base64url');

interface Site {
  origin: string;
  rpId: string;
}

export interface Authenticator {
  credentialId: string;
  /** What `navigator.credentials.create` returns for these options. */
  create: (options: { challenge: string }, site?: Site) => unknown;
  /** What `navigator.credentials.get` returns; `userHandle` is what the passkey stores. */
  get: (options: { challenge: string }, site?: Site, userHandle?: string) => unknown;
}

/** A big-endian 32-bit signature counter. */
function count(n: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32BE(n);
  return out;
}

const clientData = (type: string, challenge: string, origin: string): Buffer =>
  Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));

/** The credential public key in COSE form (ES256). */
function coseKey(publicKey: KeyObject): Buffer {
  const jwk = publicKey.export({ format: 'jwk' });
  return cbor(
    new Map<number, Cbor>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x ?? '', 'base64url')],
      [-3, Buffer.from(jwk.y ?? '', 'base64url')],
    ]),
  );
}

/** The registration answer: authenticator data with the new credential, wrapped as "none" attestation. */
function attestation(authData: Buffer): Buffer {
  return cbor(
    new Map<number | string, Cbor>([
      ['fmt', 'none'],
      ['attStmt', new Map()],
      ['authData', authData],
    ]),
  );
}

export function newAuthenticator(
  site: Site,
  options: { userHandle?: string; userVerified?: boolean } = {},
): Authenticator {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const credentialId = randomBytes(32);
  const flags = (extra: number): Buffer =>
    Buffer.from([0x01 | (options.userVerified === false ? 0 : 0x04) | extra]);
  const answer = (response: object) => ({
    id: b64(credentialId),
    rawId: b64(credentialId),
    type: 'public-key',
    response,
    clientExtensionResults: {},
  });
  let uses = 0;
  return {
    credentialId: b64(credentialId),
    create: (given, where = site) => {
      const length = Buffer.alloc(2);
      length.writeUInt16BE(credentialId.length);
      const header = [sha256(where.rpId), flags(0x40), count(0), Buffer.alloc(16), length];
      const authData = Buffer.concat([...header, credentialId, coseKey(publicKey)]);
      return answer({
        clientDataJSON: b64(clientData('webauthn.create', given.challenge, where.origin)),
        attestationObject: b64(attestation(authData)),
        transports: ['internal'],
      });
    },
    get: (given, where = site, handle = options.userHandle) => {
      uses += 1;
      const authData = Buffer.concat([sha256(where.rpId), flags(0), count(uses)]);
      const clientDataJSON = clientData('webauthn.get', given.challenge, where.origin);
      const signature = sign(
        'sha256',
        Buffer.concat([authData, sha256(clientDataJSON)]),
        privateKey,
      );
      return answer({
        authenticatorData: b64(authData),
        clientDataJSON: b64(clientDataJSON),
        signature: b64(signature),
        ...(handle === undefined ? {} : { userHandle: handle }),
      });
    },
  };
}
