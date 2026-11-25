import { z } from 'zod';
import {
  EngineError,
  type Engine,
  type EngineCallUsage,
  type EngineMessage,
  type EngineSession,
  type EngineUsage,
} from './engine.js';

/** Longest a single turn may take before it counts as a transient failure. */
const DEFAULT_TIMEOUT_MS = 100_000;
/** The header that carries the shared secret. */
const TOKEN_HEADER = 'x-engine-token';

const answer = z.object({
  text: z.string(),
  usage: z.object({
    inputTokens: z.number().nonnegative(),
    outputTokens: z.number().nonnegative(),
    costUsd: z.number().nonnegative(),
    cacheReadTokens: z.number().nonnegative().optional(),
    cacheWriteTokens: z.number().nonnegative().optional(),
  }),
});

export interface HttpEngineOptions {
  /** Base URL of an engine you host yourself. */
  url: string;
  /** Shared secret, sent in the `x-engine-token` header. Never logged. */
  token: string;
  timeoutMs?: number;
}

const ZERO: EngineUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };

/** 5xx, timeouts and "slow down" are worth a retry; any other 4xx is not. Messages carry no user text. */
function fromStatus(status: number): EngineError {
  const transient = status >= 500 || status === 429 || status === 408;
  return new EngineError(transient ? 'transient' : 'failed', `engine answered ${String(status)}`);
}

async function post(
  options: HttpEngineOptions,
  path: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<Response> {
  const base = options.url.endsWith('/') ? options.url : `${options.url}/`;
  let response: Response;
  try {
    response = await fetch(new URL(path, base), {
      method: 'POST',
      headers: { 'content-type': 'application/json', [TOKEN_HEADER]: options.token },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    throw new EngineError('transient', 'engine unreachable or timed out');
  }
  if (!response.ok) throw fromStatus(response.status);
  return response;
}

class HttpSession implements EngineSession {
  private readonly controller = new AbortController();
  private readonly log: EngineMessage[] = [];
  private readonly steered: string[] = [];
  private used: EngineUsage = ZERO;

  constructor(
    private readonly options: HttpEngineOptions,
    private readonly conversationId: string,
    private readonly onUsage: ((call: EngineCallUsage) => void) | undefined,
  ) {}

  async prompt(text: string): Promise<string> {
    const sent = [...this.steered.splice(0), text].join('\n\n');
    this.log.push({ role: 'user', text: sent });
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const signal = AbortSignal.any([this.controller.signal, timeout]);
    try {
      const response = await post(
        this.options,
        'turn',
        { conversationId: this.conversationId, text: sent },
        signal,
      );
      const parsed = answer.safeParse(await response.json().catch(() => undefined));
      if (!parsed.success)
        throw new EngineError('failed', 'engine answered with an unexpected shape');
      const { text: reply, usage } = parsed.data;
      this.record(usage);
      this.log.push({ role: 'assistant', text: reply });
      return reply;
    } catch (error) {
      const aborted = this.controller.signal.aborted;
      this.onUsage?.({
        ...ZERO,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        status: aborted ? 'aborted' : 'failed',
      });
      if (aborted) throw new EngineError('aborted', 'aborted');
      // Our own timeout fired: the engine may still be working, so stop it before any retry.
      if (timeout.aborted) this.tellEngineToStop();
      throw error;
    }
  }

  private record(usage: z.infer<typeof answer>['usage']): void {
    this.used = {
      inputTokens: this.used.inputTokens + usage.inputTokens,
      outputTokens: this.used.outputTokens + usage.outputTokens,
      costUsd: this.used.costUsd + usage.costUsd,
    };
    this.onUsage?.({
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: usage.costUsd,
      cacheReadTokens: usage.cacheReadTokens ?? 0,
      cacheWriteTokens: usage.cacheWriteTokens ?? 0,
      status: 'ok',
    });
  }

  transcript(): EngineMessage[] {
    return [...this.log];
  }

  steer(text: string): void {
    this.steered.push(text);
  }

  abort(): void {
    if (this.controller.signal.aborted) return;
    this.controller.abort();
    this.tellEngineToStop();
  }

  /** Ask the engine to stop work for this conversation; the turn is already over here. */
  private tellEngineToStop(): void {
    post(
      this.options,
      'abort',
      { conversationId: this.conversationId },
      AbortSignal.timeout(5000),
    ).catch(() => undefined);
  }

  usage(): EngineUsage {
    return this.used;
  }
}

/**
 * An engine you host yourself: each turn is one POST of `{conversationId, text}` to `<url>/turn`,
 * answered with `{text, usage}`. Tools and history are not sent; the engine keeps its own session
 * per conversation. `/abort` and `/end` take `{conversationId}`.
 */
export function createHttpEngine(options: HttpEngineOptions): Engine {
  return {
    open: ({ conversationId, onUsage }) =>
      new HttpSession(options, conversationId ?? crypto.randomUUID(), onUsage),
    end: async (conversationId) => {
      await post(options, 'end', { conversationId }, AbortSignal.timeout(5000));
    },
  };
}
