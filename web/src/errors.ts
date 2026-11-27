const KNOWN = new Set([
  'invalid_credentials',
  'invalid_code',
  'last_sign_in_method',
  'invalid_request',
  'too_many_attempts',
  'same_password',
  'notice_required',
  'link_invalid',
  'email_taken',
  'network',
]);

/** The translation key for an API error word; anything unknown gets the generic line. */
export function errorKey(error: string): string {
  return `errors.${KNOWN.has(error) ? error : 'generic'}`;
}
