/** A monthly limit typed in dollars: empty is no limit; anything else that is not a number becomes NaN, which the server refuses. */
export function limitOf(text: string): number | null {
  const trimmed = text.trim();
  return trimmed === '' ? null : Number(trimmed);
}
