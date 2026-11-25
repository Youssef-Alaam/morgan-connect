import { createHash } from 'node:crypto';

const MAX_NAMES = 16;
const MAX_NAME_LENGTH = 40;

export interface ArgsSummary {
  /** Declared argument names that were given (capped). Never values. */
  argNames: string[];
  /** How many given arguments are not in the list above (undeclared, or past the cap). */
  extraArgs: number;
  /** Fingerprint of the full arguments, to tell two calls apart without storing them. */
  argsSha256: string;
}

/** What the audit row keeps of a call's arguments: declared names, a count, and a hash. */
export function summarizeArgs(
  args: Record<string, unknown>,
  parameters: Record<string, unknown>,
): ArgsSummary {
  const declared = parameters['properties'];
  const known =
    typeof declared === 'object' && declared !== null
      ? Object.keys(args).filter((name) => Object.hasOwn(declared, name))
      : [];
  const kept = known.slice(0, MAX_NAMES).map((name) => name.slice(0, MAX_NAME_LENGTH));
  return {
    argNames: kept,
    extraArgs: Object.keys(args).length - kept.length,
    argsSha256: createHash('sha256').update(JSON.stringify(args)).digest('hex'),
  };
}
