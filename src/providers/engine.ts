/** The one door to a model (ADR 0003): `open`, then `prompt` / `steer` / `abort` / `usage`. */
/** A tool's answer. A refusal, a timeout or another failure is flagged so the model is told it failed. */
export interface EngineToolOutput {
  text: string;
  isError: boolean;
}

export interface EngineTool {
  name: string;
  description: string;
  /** JSON Schema for the arguments. */
  parameters: Record<string, unknown>;
  /** `signal` fires when the turn is stopped; a tool should give up when it does. */
  run: (args: Record<string, unknown>, signal?: AbortSignal) => Promise<string | EngineToolOutput>;
}

export interface EngineToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** One step of a conversation: tool calls and their results are kept, matched by `id`. */
export type EngineMessage =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; toolCalls?: EngineToolCall[] }
  | { role: 'tool'; text: string; id: string; name: string; isError: boolean };

export interface EngineUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/** What one model call used, reported as soon as the call returns (even a failed one is billed). */
export interface EngineCallUsage extends EngineUsage {
  cacheReadTokens: number;
  cacheWriteTokens: number;
  status: 'ok' | 'failed' | 'aborted';
}

export interface EngineSession {
  /** Send one user message and run the model (and its tool calls) to a final text answer. */
  prompt: (text: string) => Promise<string>;
  /** The messages this session added (the user's, the model's, tool calls and results), in order. */
  transcript: () => EngineMessage[];
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
    /** Called once per model call, so a prompt with tool steps reports each call. */
    onUsage?: (call: EngineCallUsage) => void;
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
