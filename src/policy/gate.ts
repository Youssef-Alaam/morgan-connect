import type { Db } from '../data/index.js';
import type { Logger } from '../ops/index.js';
import type { EngineTool } from '../providers/index.js';
import { ACTION_TYPES, createClockTool, type ToolDefinition } from '../tools/index.js';
import { decide, OWNER_PROFILE, type Mode, type Profile } from './profile.js';
import { createRecorder, type Caller } from './recorder.js';

export type { Caller };

export interface GateOptions {
  db: Db;
  tools?: readonly ToolDefinition[];
  profile?: Profile;
  logger?: Pick<Logger, 'error'>;
}

const ASK_REFUSAL =
  'This needs the owner to approve it first, and approvals are not available yet. It was not run. Tell the user what you wanted to do instead.';
const OFF_REFUSAL = 'This tool is turned off. It was not run.';

/** The model sees `clock_now`: some model APIs do not allow dots in tool names. */
const engineName = (name: string): string => name.replaceAll('.', '_');

export interface Gate {
  /** The tools for one turn. They are the only way the engine can reach a tool. */
  toolsFor: (caller: Caller) => EngineTool[];
}

/** Refuse a bad registry at startup, not on the first call. */
function checkTools(tools: readonly ToolDefinition[]): void {
  const names = new Set<string>();
  for (const tool of tools) {
    if (!(ACTION_TYPES as readonly string[]).includes(tool.actionType)) {
      throw new Error(`Tool ${tool.name} has an unknown action type`);
    }
    if (names.has(engineName(tool.name))) throw new Error(`Two tools are named ${tool.name}`);
    names.add(engineName(tool.name));
  }
}

const refusalFor = (mode: Mode): string => (mode === 'ask' ? ASK_REFUSAL : OFF_REFUSAL);

/**
 * The one gate (L2): every tool call goes through here, is decided by the profile, and writes
 * exactly one audit row, after the run, so the row records how it went.
 */
export function createGate(options: GateOptions): Gate {
  const { db, tools = [createClockTool()], profile = OWNER_PROFILE, logger } = options;
  checkTools(tools);
  const { record, recordAfterRun } = createRecorder(db, logger);

  async function invoke(
    tool: ToolDefinition,
    caller: Caller,
    args: Record<string, unknown>,
  ): Promise<string> {
    const decision = decide(profile, tool.actionType);
    const call = { caller, tool, args, decision };
    if (decision !== 'auto') {
      await record({ ...call, outcome: 'refused' });
      return refusalFor(decision);
    }
    try {
      const output = await tool.run(args);
      await recordAfterRun({ ...call, outcome: 'ok' });
      return output;
    } catch (error) {
      await recordAfterRun({ ...call, outcome: 'error' });
      throw error;
    }
  }

  return {
    toolsFor: (caller) =>
      tools.map((tool) => ({
        name: engineName(tool.name),
        description: tool.description,
        parameters: tool.parameters,
        run: (args) => invoke(tool, caller, args),
      })),
  };
}
