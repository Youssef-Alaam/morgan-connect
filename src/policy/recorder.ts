import { appendAudit, type AuditOutcome, type Db } from '../data/index.js';
import type { Logger } from '../ops/index.js';
import type { ToolDefinition } from '../tools/index.js';
import { summarizeArgs } from './audit-args.js';
import type { Mode } from './profile.js';

/** Who asked: the chat and turn a tool call belongs to. */
export interface Caller {
  channel: string;
  chatId: string;
  turnId?: string | undefined;
}

/** What the audit row needs to know about a tool; a made-up tool name has no real definition. */
type Audited = Pick<ToolDefinition, 'name' | 'changesState' | 'parameters'> & {
  actionType: string;
};

interface Call {
  caller: Caller;
  tool: Audited;
  args: Record<string, unknown>;
  decision: Mode;
  outcome: AuditOutcome;
}

export interface Recorder {
  /** Write the row. A failure is raised (used before anything ran, e.g. a refusal). */
  record: (call: Call) => Promise<void>;
  /** After a run the work is done, so a failed write is logged and must not hide the result. */
  recordAfterRun: (call: Call) => Promise<void>;
}

export function createRecorder(db: Db, logger?: Pick<Logger, 'error'>): Recorder {
  const record = ({ caller, tool, args, decision, outcome }: Call): Promise<void> =>
    appendAudit(db, {
      ...caller,
      tool: tool.name.slice(0, 64),
      actionType: tool.actionType,
      changesState: tool.changesState,
      ...summarizeArgs(args, tool.parameters),
      decision,
      outcome,
    });
  return {
    record,
    recordAfterRun: async (call) => {
      try {
        await record(call);
      } catch {
        logger?.error({ tool: call.tool.name }, 'audit write failed after the tool ran');
      }
    },
  };
}
