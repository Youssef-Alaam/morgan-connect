/** The one-time token in a link like `/set-password#token=...`. It lives in the hash, which a browser never sends. */
export function tokenFromHash(hash: string): string {
  return new URLSearchParams(hash.replace(/^#/, '')).get('token') ?? '';
}
