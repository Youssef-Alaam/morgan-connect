import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPasskey, passkeysSupported } from './passkey.ts';

class FakeCredential {
  static parseCreationOptionsFromJSON = vi.fn((options: unknown) => ({ parsed: options }));
  toJSON(): object {
    return { id: 'cred-1', type: 'public-key' };
  }
}

const create = vi.fn<() => Promise<unknown>>();

function browser(answer: () => Promise<unknown>): void {
  create.mockImplementation(answer);
  vi.stubGlobal('PublicKeyCredential', FakeCredential);
  vi.stubGlobal('navigator', { credentials: { create } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createPasskey', () => {
  it('hands the parsed options to the authenticator and returns its JSON', async () => {
    browser(() => Promise.resolve(new FakeCredential()));
    expect(await createPasskey({ challenge: 'c' })).toEqual({ id: 'cred-1', type: 'public-key' });
    expect(create).toHaveBeenCalledWith({ publicKey: { parsed: { challenge: 'c' } } });
  });

  it('returns nothing when the person cancels or the browser refuses', async () => {
    browser(() => Promise.reject(new Error('NotAllowedError')));
    expect(await createPasskey({})).toBeUndefined();
  });

  it('returns nothing when what came back is not a passkey', async () => {
    browser(() => Promise.resolve({}));
    expect(await createPasskey({})).toBeUndefined();
  });

  it('returns nothing, without asking, in a browser that cannot make passkeys', async () => {
    vi.stubGlobal('PublicKeyCredential', undefined);
    expect(passkeysSupported()).toBe(false);
    expect(await createPasskey({})).toBeUndefined();
  });
});
