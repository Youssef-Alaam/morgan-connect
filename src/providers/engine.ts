/** The one door to a model (ADR 0003): `open`, then `prompt` / `steer` / `abort` / `usage`. */
export interface EngineTool {
  name: string;
  description: string;
  /** JSON Schema for the arguments. */
  parameters: Record<string, unknown>;
  /** `signal` fires when the turn is stopped; a tool should give up when it does. */
  run: (args: Record<string, unknown>, signal?: AbortSignal) => Promise<string>;
}

export interface EngineMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface EngineUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface EngineSession {
  /** Send one user message and run the model (and its tool calls) to a final text answer. */
  prompt: (text: string) => Promise<string>;
  /** Add a user message that the model sees before its next step. */
  steer: (text: string) => void;
  /** Stop the running prompt. It rejects with an `aborted` error. */
  abort: () => void;
  /** Everything this session has used so far. */
  usage: () => EngineUsage;
}

export interface Engine {
  open: (options: {
    history: readonly EngineMessage[];
    system?: string;
    tools?: readonly EngineTool[];
    /** Called when the model names a tool that is not in `tools`, so the caller can record it. */
    unknownTool?: (name: string, args: Record<string, unknown>) => Promise<string>;
  }) => EngineSession;
}

export type EngineErrorKind = 'transient' | 'failed' | 'aborted';

/** What a session raises. `transient` is worth retrying; messages never contain user text. */
export class EngineError extends Error {
  constructor(
    readonly kind: EngineErrorKind,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'EngineError';
  }
}
