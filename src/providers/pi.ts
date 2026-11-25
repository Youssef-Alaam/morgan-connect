import {
  type AssistantMessage,
  type Context,
  type Message,
  type Model,
  type Models,
  type ToolCall,
  createModels,
} from '@earendil-works/pi-ai';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import {
  EngineError,
  type Engine,
  type EngineCallUsage,
  type EngineMessage,
  type EngineSession,
  type EngineTool,
  type EngineToolOutput,
  type EngineUsage,
} from './engine.js';

type UnknownTool = NonNullable<Parameters<Engine['open']>[0]['unknownTool']>;

/** Model calls in one prompt, so a model stuck calling tools cannot run forever. */
const MAX_STEPS = 10;
/** Only a busy or unreachable service is worth a retry; any other 4xx (bad request, key) is not. */
const TRANSIENT =
  /(?:^|status[:\s]+|error[:\s]+)(?:429|5\d\d)\b|overloaded|rate.?limit|timed? ?out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|network|socket/i;

export function isTransient(message: string): boolean {
  return TRANSIENT.test(message);
}

export interface PiEngineOptions {
  models: Models;
  model: Model<string>;
  apiKey: string;
  system?: string;
  onUsage?: (call: EngineCallUsage) => void;
}

function pastMessage(message: EngineMessage, model: Model<string>): Message {
  const timestamp = Date.now();
  if (message.role === 'user') return { role: 'user', content: message.text, timestamp };
  if (message.role === 'tool') {
    return {
      role: 'toolResult',
      toolCallId: message.id,
      toolName: message.name,
      content: [{ type: 'text', text: message.text }],
      isError: message.isError,
      timestamp,
    };
  }
  const calls = message.toolCalls ?? [];
  const cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost };
  const content: AssistantMessage['content'] = [
    ...(message.text === '' ? [] : [{ type: 'text' as const, text: message.text }]),
    ...calls.map((c) => ({
      type: 'toolCall' as const,
      id: c.id,
      name: c.name,
      arguments: c.args as ToolCall['arguments'],
    })),
  ];
  return {
    role: 'assistant',
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage,
    stopReason: calls.length === 0 ? 'stop' : 'toolUse',
    timestamp,
  };
}

/** A Pi message as a stored one. Thinking blocks are not kept. */
function toEngineMessage(message: Message): EngineMessage {
  if (message.role === 'user') {
    const { content } = message;
    const text =
      typeof content === 'string'
        ? content
        : content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    return { role: 'user', text };
  }
  if (message.role === 'toolResult') {
    const text = message.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    return {
      role: 'tool',
      text,
      id: message.toolCallId,
      name: message.toolName,
      isError: message.isError,
    };
  }
  if (message.role !== 'assistant') return { role: 'assistant', text: '' };
  const text = message.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  const toolCalls = message.content.flatMap((b) =>
    b.type === 'toolCall' ? [{ id: b.id, name: b.name, args: b.arguments }] : [],
  );
  return toolCalls.length === 0
    ? { role: 'assistant', text }
    : { role: 'assistant', text, toolCalls };
}

class PiSession implements EngineSession {
  private readonly context: Context;
  private readonly historyLength: number;
  private readonly steered: string[] = [];
  private readonly controller = new AbortController();
  private readonly used: EngineUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };

  constructor(
    private readonly options: PiEngineOptions,
    history: readonly EngineMessage[],
    private readonly tools: readonly EngineTool[],
    private readonly unknownTool?: UnknownTool,
  ) {
    this.context = {
      ...(options.system === undefined ? {} : { systemPrompt: options.system }),
      messages: history.map((m) => pastMessage(m, options.model)),
      tools: tools.map(({ name, description, parameters }) => ({ name, description, parameters })),
    };
    this.historyLength = this.context.messages.length;
  }

  async prompt(text: string): Promise<string> {
    this.context.messages.push({ role: 'user', content: text, timestamp: Date.now() });
    for (let step = 0; step < MAX_STEPS; step += 1) {
      const reply = await this.callModel();
      this.context.messages.push(reply);
      const calls = reply.content.filter((block) => block.type === 'toolCall');
      if (calls.length === 0) {
        return reply.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
      }
      for (const call of calls) {
        if (this.controller.signal.aborted)
          throw new EngineError('aborted', 'The turn was aborted');
        await this.runTool(call.id, call.name, call.arguments);
      }
      for (const note of this.steered.splice(0)) {
        this.context.messages.push({ role: 'user', content: note, timestamp: Date.now() });
      }
    }
    throw new EngineError('failed', 'The model kept calling tools without answering');
  }

  private async callModel(): Promise<AssistantMessage> {
    const { models, model, apiKey } = this.options;
    const reply = await models.complete(model, this.context, {
      apiKey,
      signal: this.controller.signal,
    });
    this.used.inputTokens += reply.usage.input;
    this.used.outputTokens += reply.usage.output;
    this.used.costUsd += reply.usage.cost.total;
    this.options.onUsage?.({
      inputTokens: reply.usage.input,
      outputTokens: reply.usage.output,
      cacheReadTokens: reply.usage.cacheRead,
      cacheWriteTokens: reply.usage.cacheWrite,
      costUsd: reply.usage.cost.total,
      status:
        reply.stopReason === 'error' ? 'failed' : reply.stopReason === 'aborted' ? 'aborted' : 'ok',
    });
    if (reply.stopReason === 'aborted') throw new EngineError('aborted', 'The turn was aborted');
    if (reply.stopReason === 'error') {
      throw new EngineError(
        isTransient(reply.errorMessage ?? '') ? 'transient' : 'failed',
        'The model call failed',
      );
    }
    return reply;
  }

  private async runTool(id: string, name: string, args: Record<string, unknown>): Promise<void> {
    const tool = this.tools.find((t) => t.name === name);
    const unknown = this.unknownTool;
    const call = tool?.run ?? (unknown === undefined ? undefined : (a) => unknown(name, a));
    const result = call === undefined ? `Unknown tool ${name}` : await this.run(call, args);
    const { text, isError } =
      typeof result === 'string' ? { text: result, isError: tool === undefined } : result;
    this.context.messages.push({
      role: 'toolResult',
      toolCallId: id,
      toolName: name,
      content: [{ type: 'text', text }],
      isError,
      timestamp: Date.now(),
    });
  }

  private async run(
    call: EngineTool['run'],
    args: Record<string, unknown>,
  ): Promise<string | EngineToolOutput> {
    try {
      return await call(args, this.controller.signal);
    } catch (error) {
      throw new EngineError('failed', 'A tool failed', { cause: error });
    }
  }

  transcript(): EngineMessage[] {
    return this.context.messages.slice(this.historyLength).map(toEngineMessage);
  }
  steer(text: string): void {
    this.steered.push(text);
  }
  abort(): void {
    this.controller.abort();
  }
  usage(): EngineUsage {
    return { ...this.used };
  }
}

/** An engine over any Pi `Models` collection. Tests pass Pi's own scripted provider here. */
export function createPiEngine(options: PiEngineOptions): Engine {
  return {
    open: ({ history, tools = [], system, unknownTool, onUsage }) => {
      const merged = {
        ...options,
        ...(system === undefined ? {} : { system }),
        ...(onUsage === undefined ? {} : { onUsage }),
      };
      return new PiSession(merged, history, tools, unknownTool);
    },
  };
}

/**
 * Pi reads ANTHROPIC_AUTH_TOKEN and ANTHROPIC_OAUTH_TOKEN from the environment. Here the only
 * credential Pi can see is the configured key, so an ambient token can never replace it.
 */
export function createAnthropicModels(apiKey: string): Models {
  const models = createModels({
    authContext: {
      env: (name) => Promise.resolve(name === 'ANTHROPIC_API_KEY' ? apiKey : undefined),
      fileExists: () => Promise.resolve(false),
    },
  });
  models.setProvider(anthropicProvider());
  return models;
}

/** Claude through Pi on an Anthropic API key. The key is passed per call and never logged. */
export function createAnthropicEngine(options: {
  apiKey: string;
  modelId: string;
  system?: string;
}): Engine {
  const models = createAnthropicModels(options.apiKey);
  const model = models.getModel('anthropic', options.modelId);
  if (model === undefined) throw new EngineError('failed', 'Unknown Anthropic model id');
  const { apiKey, system } = options;
  return createPiEngine({ models, model, apiKey, ...(system === undefined ? {} : { system }) });
}
