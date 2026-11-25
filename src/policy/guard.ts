import { EngineError } from '../providers/index.js';
import type { ToolDefinition } from '../tools/index.js';

export type Ran =
  | { kind: 'ok'; output: string }
  | { kind: 'timeout' }
  | { kind: 'aborted' }
  | { kind: 'error'; error: unknown };

/** Rejects when the signal fires, so a tool that ignores its signal cannot hold the turn. */
function whenStopped(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    const stop = (): void => {
      reject(new Error('stopped'));
    };
    if (signal.aborted) stop();
    signal.addEventListener('abort', stop, { once: true });
  });
}

/** Run one tool, ending early when the turn is stopped or `timeoutMs` passes. Never throws. */
export async function runGuarded(
  tool: ToolDefinition,
  args: Record<string, unknown>,
  turn: AbortSignal | undefined,
  timeoutMs: number,
): Promise<Ran> {
  const stopped = (): boolean => turn?.aborted === true;
  if (stopped()) return { kind: 'aborted' };
  const limit = AbortSignal.timeout(timeoutMs);
  const both = AbortSignal.any(turn === undefined ? [limit] : [turn, limit]);
  try {
    const output = await Promise.race([tool.run(args, both), whenStopped(both)]);
    return { kind: 'ok', output };
  } catch (error) {
    if (stopped()) return { kind: 'aborted' };
    if (limit.aborted) return { kind: 'timeout' };
    return { kind: 'error', error };
  }
}

export const abortedError = (): EngineError => new EngineError('aborted', 'The turn was aborted');
