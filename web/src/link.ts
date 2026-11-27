/** The one-time token in a link like `/set-password#token=...`. It lives in the hash, which a browser never sends. */
export function tokenFromHash(hash: string): string {
  return new URLSearchParams(hash.replace(/^#/, '')).get('token') ?? '';
}

/** Read the token once and take it out of the address bar, so it is not left in history or a screenshot. */
export function takeToken(): string {
  const token = tokenFromHash(window.location.hash);
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return token;
}
