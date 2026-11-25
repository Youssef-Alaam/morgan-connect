/** What a tool does to the world. Only `read` is harmless; every other type can change something. */
export const ACTION_TYPES = ['read', 'create', 'overwrite', 'delete', 'send', 'execute'] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

/** A tool the model may ask for. Only the policy gate may run one (STANDARDS section 7). */
export interface ToolDefinition {
  /** Dotted name, e.g. `clock.now`. */
  name: string;
  description: string;
  /** JSON Schema for the arguments. */
  parameters: Record<string, unknown>;
  actionType: ActionType;
  /** True when the tool changes anything outside Morgan (such a tool is never retried). */
  changesState: boolean;
  /** `signal` fires when the turn is stopped or the time limit passes; give up when it does. */
  run: (args: Record<string, unknown>, signal?: AbortSignal) => Promise<string>;
}
