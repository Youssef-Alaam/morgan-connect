const KNOWN = new Set(['invalid_credentials', 'invalid_request', 'too_many_attempts', 'network']);

/** The translation key for an API error word; anything unknown gets the generic line. */
export function errorKey(error: string): string {
  return `errors.${KNOWN.has(error) ? error : 'generic'}`;
}
