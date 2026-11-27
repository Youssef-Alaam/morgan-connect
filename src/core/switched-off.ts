import { SWITCHED_OFF, type Gate } from '../policy/index.js';

/** The user is told by us, not left to the model, that an action was switched off for their chat. */
export function withSwitchedOffNote(
  gate: Gate | undefined,
  turnId: string,
  answer: string,
): string {
  const off = gate?.takeSwitchedOff(turnId) === true && !answer.includes(SWITCHED_OFF);
  return off
    ? `${answer}

${SWITCHED_OFF}`
    : answer;
}
