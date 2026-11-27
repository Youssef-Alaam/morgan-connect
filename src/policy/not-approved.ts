import type { AuditOutcome } from '../data/index.js';
import type { EngineToolOutput } from '../providers/index.js';
import type { ToolDefinition } from '../tools/index.js';
import type { Approvals, Verdict } from './approvals.js';
import { abortedError } from './guard.js';
import type { Mode } from './profile.js';
import type { Caller, Recorder } from './recorder.js';

const ASK_REFUSAL =
  'This needs the owner to approve it first, and approvals are not set up. It was not run. Tell the user what you wanted to do instead.';
const DENIED_REFUSAL =
  'The owner said no. It was not run. Do not try it again; tell the user it was not done.';
const EXPIRED_REFUSAL =
  'Nobody approved it in time. It was not run. Tell the user, and ask again only if they want it.';
const UNAVAILABLE_REFUSAL =
  'The owner could not be asked, so it was not run. Tell the user what you wanted to do instead.';
/** What the user is told when the profile has the action off (story 27); i18n key `policy.switchedOff`. */
export const SWITCHED_OFF = 'This is switched off for this chat.';
const OFF_REFUSAL = `${SWITCHED_OFF} It was not run. Do not try another way; tell the user exactly: "${SWITCHED_OFF}"`;
const refusalFor = (mode: Mode): string => (mode === 'ask' ? ASK_REFUSAL : OFF_REFUSAL);

/** What the audit row and the model get when the owner did not approve. */
const NOT_APPROVED = {
  denied: { outcome: 'denied', text: DENIED_REFUSAL },
  expired: { outcome: 'expired', text: EXPIRED_REFUSAL },
  unavailable: { outcome: 'refused', text: UNAVAILABLE_REFUSAL },
  aborted: { outcome: 'aborted', text: '' },
  failed: { outcome: 'error', text: UNAVAILABLE_REFUSAL },
} as const satisfies Record<
  Exclude<Verdict | 'failed', 'approved'>,
  { outcome: AuditOutcome; text: string }
>;

export interface Call {
  caller: Caller;
  tool: ToolDefinition;
  args: Record<string, unknown>;
}

/**
 * Before a tool runs: refuse it (off, or ask with nobody to ask), or ask the owner and wait.
 * Undefined means go ahead. A refusal is audited here, once; the caller must not audit it again.
 */
export async function beforeRun(
  step: { decision: Mode; approvals: Approvals | undefined; signal: AbortSignal | undefined },
  call: Call,
  recorder: Recorder,
): Promise<EngineToolOutput | undefined> {
  const { decision, approvals, signal } = step;
  if (decision === 'auto') return undefined;
  if (decision === 'off' || approvals === undefined) {
    await recorder.record({ ...call, decision, outcome: 'refused' });
    return { text: refusalFor(decision), isError: true };
  }
  // A question that could not even be put (a database error) is still audited, and refused.
  const verdict = await approvals.request({ ...call, signal }).catch(() => 'failed' as const);
  if (verdict === 'approved') return undefined;
  const { outcome, text } = NOT_APPROVED[verdict];
  // Nothing ran, so a failed audit write is raised, as for any other refusal.
  const write =
    verdict === 'unavailable' || verdict === 'failed' ? recorder.record : recorder.recordAfterRun;
  await write({ ...call, decision, outcome });
  if (verdict === 'aborted') throw abortedError();
  return { text, isError: true };
}
