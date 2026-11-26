import type { Db } from '../data/index.js';
import type { Logger } from '../ops/index.js';
import type { EngineTool, EngineToolOutput } from '../providers/index.js';
import { untrusted, wrapUntrusted } from '../safety/index.js';
import { ACTION_TYPES, createClockTool, type ToolDefinition } from '../tools/index.js';
import { abortedError, runGuarded } from './guard.js';
import { decide, OWNER_PROFILE, type Mode, type Profile } from './profile.js';
import { createRecorder, type Caller } from './recorder.js';

export type { Caller };

export interface GateOptions {
  db: Db;
  /** The zone the clock tool answers in (the TIMEZONE setting). */
  timezone?: string;
  tools?: readonly ToolDefinition[];
  profile?: Profile;
  logger?: Pick<Logger, 'error'>;
  /** A tool that runs longer than this is stopped (default 30 s). */
  toolTimeoutMs?: number;
}

const ASK_REFUSAL =
  'This needs the owner to approve it first, and approvals are not available yet. It was not run. Tell the user what you wanted to do instead.';
const OFF_REFUSAL = 'This tool is turned off. It was not run.';
const UNKNOWN_REFUSAL = 'There is no such tool. Use only the tools you were given.';
const TIMEOUT_MESSAGE = 'The tool took too long and was stopped.';

/** The model sees `clock_now`: some model APIs do not allow dots in tool names. */
const engineName = (name: string): string => name.replaceAll('.', '_');

export interface Gate {
  /** The tools for one turn. They are the only way the engine can reach a tool. */
  toolsFor: (caller: Caller) => EngineTool[];
  /** For a tool name the model made up: refused, and recorded. */
  unknownTool: (caller: Caller) => (name: string, args: Record<string, unknown>) => Promise<string>;
}

/** A tool's error message can carry outside text too, so the model sees it fenced. */
function fencedError(tool: ToolDefinition, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  const source = `tool ${engineName(tool.name)} error`;
  return new Error(wrapUntrusted(untrusted(message), source), { cause: error });
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
  const {
    db,
    timezone,
    tools = [createClockTool({ ...(timezone === undefined ? {} : { timezone }) })],
    profile = OWNER_PROFILE,
    logger,
  } = options;
  const timeoutMs = options.toolTimeoutMs ?? 30_000;
  checkTools(tools);
  const { record, recordAfterRun } = createRecorder(db, logger);

  async function invoke(
    tool: ToolDefinition,
    caller: Caller,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<string | EngineToolOutput> {
    const decision = decide(profile, tool.actionType);
    const call = { caller, tool, args, decision };
    if (decision !== 'auto') {
      await record({ ...call, outcome: 'refused' });
      return { text: refusalFor(decision), isError: true };
    }
    const ran = await runGuarded(tool, args, signal, timeoutMs);
    const outcome = ran.kind === 'ok' ? 'ok' : ran.kind === 'aborted' ? 'aborted' : 'error';
    await recordAfterRun({ ...call, outcome });
    // What a tool returns came from outside: the model gets it fenced as data (STANDARDS section 6).
    if (ran.kind === 'ok')
      return wrapUntrusted(untrusted(ran.output), `tool ${engineName(tool.name)}`);
    if (ran.kind === 'timeout') return { text: TIMEOUT_MESSAGE, isError: true };
    if (ran.kind === 'aborted') throw abortedError();
    throw fencedError(tool, ran.error);
  }

  return {
    toolsFor: (caller) =>
      tools.map((tool) => ({
        name: engineName(tool.name),
        description: tool.description,
        parameters: tool.parameters,
        run: (args, signal) => invoke(tool, caller, args, signal),
      })),
    unknownTool: (caller) => async (name, args) => {
      const tool = { name, actionType: 'unknown', changesState: false, parameters: {} };
      await record({ caller, tool, args, decision: 'off', outcome: 'refused' });
      return UNKNOWN_REFUSAL;
    },
  };
}
