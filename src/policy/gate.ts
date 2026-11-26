import { ownerOf, type Db } from '../data/index.js';
import type { Logger } from '../ops/index.js';
import type { EngineTool, EngineToolOutput } from '../providers/index.js';
import { untrusted, wrapUntrusted } from '../safety/index.js';
import {
  ACTION_TYPES,
  createClockTool,
  createDemoGatedTool,
  createVault,
  createVaultCaptureTool,
  type ToolDefinition,
  type VaultOptions,
} from '../tools/index.js';
import type { Approvals } from './approvals.js';
import { abortedError, runGuarded } from './guard.js';
import { decide, type Mode } from './profile.js';
import { profileFor } from './profiles.js';
import { createRecorder, type Caller } from './recorder.js';
import { beforeRun } from './not-approved.js';

export type { Caller };

export interface GateOptions {
  db: Db;
  /** The zone the clock tool answers in (the TIMEZONE setting). */
  timezone?: string;
  tools?: readonly ToolDefinition[];
  /** Add the harmless `demo.gated` test tool, which always needs approval (the DEMO_TOOLS setting). */
  demo?: boolean;
  /** Where `vault.capture` saves notes. Unset: the tool is not registered. */
  vault?: VaultOptions;
  /** Asks the owner before an `ask` tool runs. Without it, `ask` tools are refused. */
  approvals?: Approvals;
  logger?: Pick<Logger, 'error'>;
  /** A tool that runs longer than this is stopped (default 30 s). */
  toolTimeoutMs?: number;
}

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

const defaultTools = (options: GateOptions): ToolDefinition[] => [
  createClockTool({ ...(options.timezone === undefined ? {} : { timezone: options.timezone }) }),
  ...(options.demo === true ? [createDemoGatedTool()] : []),
  ...(options.vault === undefined ? [] : [createVaultCaptureTool(createVault(options.vault))]),
];

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

/**
 * The one gate (L2): every tool call goes through here, is decided by the profile, and writes
 * exactly one audit row, after the run, so the row records how it went.
 */
export function createGate(options: GateOptions): Gate {
  const { db, approvals, logger } = options;
  const tools = options.tools ?? defaultTools(options);
  const timeoutMs = options.toolTimeoutMs ?? 30_000;
  checkTools(tools);
  const recorder = createRecorder(db, logger);

  /** The person's profile on this chat decides; a chat nobody linked gets `off`. */
  async function decisionFor(caller: Caller, tool: ToolDefinition): Promise<Mode> {
    const owner = await ownerOf(db, caller);
    if (owner === undefined) return 'off';
    const { modes } = await profileFor(db, owner, caller);
    return decide(modes, tool.actionType);
  }

  async function invoke(
    tool: ToolDefinition,
    caller: Caller,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<string | EngineToolOutput> {
    const decision = await decisionFor(caller, tool);
    const call = { caller, tool, args, decision };
    const stopped = await beforeRun(
      { decision, approvals, signal },
      { caller, tool, args },
      recorder,
    );
    if (stopped !== undefined) return stopped;
    const ran = await runGuarded(tool, args, signal, timeoutMs);
    const outcome = ran.kind === 'ok' ? 'ok' : ran.kind === 'aborted' ? 'aborted' : 'error';
    await recorder.recordAfterRun({ ...call, outcome });
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
      await recorder.record({ caller, tool, args, decision: 'off', outcome: 'refused' });
      return UNKNOWN_REFUSAL;
    },
  };
}
