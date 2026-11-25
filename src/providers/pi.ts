import {
  type AssistantMessage,
  type Context,
  type Message,
  type Model,
  type Models,
  createModels,
} from '@earendil-works/pi-ai';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import {
  EngineError,
  type Engine,
  type EngineMessage,
  type EngineSession,
  type EngineTool,
  type EngineUsage,
} from './engine.js';

/** Model calls in one prompt, so a model stuck calling tools cannot run forever. */
const MAX_STEPS = 10;
const AUTH_FAILURE = /\b(401|403)\b|authentication|invalid x-api-key|permission/i;

export interface PiEngineOptions {
  models: Models;
  model: Model<string>;
  apiKey: string;
  system?: string;
}

function pastMessage(message: EngineMessage, model: Model<string>): Message {
  const timestamp = Date.now();
  if (message.role === 'user') return { role: 'user', content: message.text, timestamp };
  const cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost };
  return {
    role: 'assistant',
    content: [{ type: 'text', text: message.text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage,
    stopReason: 'stop',
    timestamp,
  };
}

class PiSession implements EngineSession {
  private readonly context: Context;
  private readonly steered: string[] = [];
  private readonly controller = new AbortController();
  private readonly used: EngineUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };

  constructor(
    private readonly options: PiEngineOptions,
    history: readonly EngineMessage[],
    private readonly tools: readonly EngineTool[],
  ) {
    this.context = {
      ...(options.system === undefined ? {} : { systemPrompt: options.system }),
      messages: history.map((m) => pastMessage(m, options.model)),
      tools: tools.map(({ name, description, parameters }) => ({ name, description, parameters })),
    };
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
      for (const call of calls) await this.runTool(call.id, call.name, call.arguments);
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
    if (reply.stopReason === 'aborted') throw new EngineError('aborted', 'The turn was aborted');
    if (reply.stopReason === 'error') {
      const kind = AUTH_FAILURE.test(reply.errorMessage ?? '') ? 'failed' : 'transient';
      throw new EngineError(kind, 'The model call failed');
    }
    return reply;
  }

  private async runTool(id: string, name: string, args: Record<string, unknown>): Promise<void> {
    const tool = this.tools.find((t) => t.name === name);
    const output = tool === undefined ? `Unknown tool ${name}` : await tool.run(args);
    this.context.messages.push({
      role: 'toolResult',
      toolCallId: id,
      toolName: name,
      content: [{ type: 'text', text: output }],
      isError: tool === undefined,
      timestamp: Date.now(),
    });
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
    open: ({ history, tools = [], system }) => {
      const merged = system === undefined ? options : { ...options, system };
      return new PiSession(merged, history, tools);
    },
  };
}

/** Claude through Pi on an Anthropic API key. The key is passed per call and never logged. */
export function createAnthropicEngine(options: {
  apiKey: string;
  modelId: string;
  system?: string;
}): Engine {
  const models = createModels();
  models.setProvider(anthropicProvider());
  const model = models.getModel('anthropic', options.modelId);
  if (model === undefined) throw new EngineError('failed', 'Unknown Anthropic model id');
  const { apiKey, system } = options;
  return createPiEngine({ models, model, apiKey, ...(system === undefined ? {} : { system }) });
}
