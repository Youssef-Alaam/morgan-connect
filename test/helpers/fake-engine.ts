import {
  EngineError,
  type Engine,
  type EngineMessage,
  type EngineSession,
  type EngineTool,
  type EngineUsage,
} from '../../src/policy/index.js';

/** One scripted model step: a tool call, a plain answer, or an error. */
export type Step =
  | { tool: string; args: Record<string, unknown> }
  | { text: string }
  | { error: 'transient' | 'failed' }
  | { hang: true }
  /** Answer with the last steer message, so a test can see it reached the model. */
  | { echoSteer: true };

/** A model that replays fixed steps. Records what each session was opened and prompted with. */
export class ScriptedEngine implements Engine {
  readonly opened: {
    history: readonly EngineMessage[];
    tools: readonly EngineTool[];
    system: string | undefined;
    conversationId: string | undefined;
  }[] = [];
  readonly prompts: string[] = [];
  readonly ended: string[] = [];
  /** Set to make `end` fail, to prove a failure there does not block `/new`. */
  endFails = false;
  readonly sessions: ScriptedSession[] = [];
  constructor(private readonly script: Step[]) {}

  end = (conversationId: string): Promise<void> => {
    if (this.endFails) return Promise.reject(new Error('end failed'));
    this.ended.push(conversationId);
    return Promise.resolve();
  };

  open(options: Parameters<Engine['open']>[0]): EngineSession {
    this.opened.push({
      history: options.history,
      tools: options.tools ?? [],
      system: options.system,
      conversationId: options.conversationId,
    });
    const session = new ScriptedSession(
      this.script,
      options.tools ?? [],
      this.prompts,
      options.unknownTool,
    );
    this.sessions.push(session);
    return session;
  }
}

class ScriptedSession implements EngineSession {
  readonly steered: string[] = [];
  private aborted = new AbortController();
  private tokens = 0;
  private readonly log: EngineMessage[] = [];
  private calls = 0;
  constructor(
    private readonly script: Step[],
    private readonly tools: readonly EngineTool[],
    private readonly prompts: string[],
    private readonly unknownTool?: (name: string, args: Record<string, unknown>) => Promise<string>,
  ) {}

  async prompt(text: string): Promise<string> {
    this.prompts.push(text);
    this.log.push({ role: 'user', text });
    this.tokens += 1;
    for (;;) {
      const step = this.script.shift();
      if (step === undefined) throw new EngineError('failed', 'script ran out');
      if (this.aborted.signal.aborted) throw new EngineError('aborted', 'aborted');
      if ('text' in step) {
        this.log.push({ role: 'assistant', text: step.text });
        return step.text;
      }
      if ('echoSteer' in step) return this.steered.at(-1) ?? '';
      if ('error' in step) throw new EngineError(step.error, 'scripted error');
      if ('hang' in step) await this.waitForAbort();
      else await this.runTool(step);
    }
  }

  private async runTool(step: { tool: string; args: Record<string, unknown> }): Promise<void> {
    const tool = this.tools.find((t) => t.name === step.tool);
    const id = `call-${String((this.calls += 1))}`;
    const toolCalls = [{ id, name: step.tool, args: step.args }];
    this.log.push({ role: 'assistant', text: '', toolCalls });
    let output: string | { text: string; isError: boolean };
    if (tool !== undefined) output = await tool.run(step.args, this.abortSignal());
    else if (this.unknownTool !== undefined) output = await this.unknownTool(step.tool, step.args);
    else throw new EngineError('failed', 'unknown tool');
    const { text: result, isError } =
      typeof output === 'string' ? { text: output, isError: tool === undefined } : output;
    this.log.push({ role: 'tool', text: result, id, name: step.tool, isError });
  }

  private abortSignal(): AbortSignal {
    return this.aborted.signal;
  }

  private waitForAbort(): Promise<never> {
    return new Promise((_resolve, reject) => {
      this.aborted.signal.addEventListener('abort', () => {
        reject(new EngineError('aborted', 'aborted'));
      });
    });
  }

  transcript(): EngineMessage[] {
    return [...this.log];
  }
  steer(text: string): void {
    this.steered.push(text);
  }
  abort(): void {
    this.aborted.abort();
  }
  usage(): EngineUsage {
    return { inputTokens: this.tokens, outputTokens: this.tokens, costUsd: 0 };
  }
}
