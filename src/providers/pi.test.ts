import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  type FauxResponseStep,
} from '@earendil-works/pi-ai';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { describeEngineContract } from '../../test/helpers/engine-contract.js';
import type { Step } from '../../test/helpers/fake-engine.js';
import type { EngineMessage } from './engine.js';
import { createAnthropicEngine, createAnthropicModels, createPiEngine, isTransient } from './pi.js';

type Scripted = Exclude<Step, { hang: true }>;

/** Answers with the newest user message, which is where Pi puts a steer note. */
const lastUserText: FauxResponseStep = (context) => {
  const user = context.messages.findLast((m) => m.role === 'user');
  return fauxAssistantMessage(fauxText(typeof user?.content === 'string' ? user.content : ''));
};

function fauxModels(): {
  faux: ReturnType<typeof fauxProvider>;
  models: ReturnType<typeof createModels>;
} {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  return { faux, models };
}

const reply = (step: Scripted): FauxResponseStep => {
  if ('tool' in step) {
    return fauxAssistantMessage(fauxToolCall(step.tool, step.args as never), {
      stopReason: 'toolUse',
    });
  }
  if ('text' in step) return fauxAssistantMessage(fauxText(step.text));
  if ('echoSteer' in step) return lastUserText;
  const errorMessage =
    step.error === 'failed' ? '400 invalid_request_error' : '529 overloaded_error';
  return fauxAssistantMessage([], { stopReason: 'error', errorMessage });
};

function engineFor(script: Step[]): ReturnType<typeof createPiEngine> {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  faux.setResponses(script.filter((s): s is Scripted => !('hang' in s)).map(reply));
  return createPiEngine({ models, model: faux.getModel(), apiKey: 'test-key' });
}

describeEngineContract('Pi adapter on Pi faux provider', engineFor);

it('stops a model that keeps calling tools without answering', async () => {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  faux.setResponses(Array.from({ length: 12 }, () => reply({ tool: 'loop', args: {} })));
  const engine = createPiEngine({ models, model: faux.getModel(), apiKey: 'k' });
  const loop = { name: 'loop', description: 'd', parameters: {}, run: () => Promise.resolve('x') };
  const session = engine.open({ history: [], tools: [loop] });
  await expect(session.prompt('go')).rejects.toMatchObject({ kind: 'failed' });
});

it('sends the system prompt and history, and tells the model about an unknown tool', async () => {
  const { faux, models } = fauxModels();
  const seen: string[] = [];
  faux.setResponses([
    reply({ tool: 'missing', args: {} }),
    (context) => {
      seen.push(JSON.stringify(context.messages));
      return fauxAssistantMessage(fauxText('ok'));
    },
  ]);
  const engine = createPiEngine({ models, model: faux.getModel(), apiKey: 'k', system: 'old' });
  const history = [
    { role: 'user', text: 'earlier question' },
    { role: 'assistant', text: 'earlier answer' },
  ] as const;
  const session = engine.open({ history, system: 'be very brief' });
  expect(await session.prompt('now')).toBe('ok');
  const sent = seen[0] ?? '';
  for (const part of ['be very brief', 'earlier question', 'earlier answer', 'now', 'toolResult']) {
    expect(sent).toContain(part);
  }
  expect(sent).not.toContain('"old"');
});

it('wraps a throwing tool as a failed error', async () => {
  const { faux, models } = fauxModels();
  faux.setResponses([reply({ tool: 'boom', args: {} })]);
  const run = (): Promise<string> => Promise.reject(new Error('disk is on fire'));
  const boom = { name: 'boom', description: 'd', parameters: {}, run };
  const session = createPiEngine({ models, model: faux.getModel(), apiKey: 'k' }).open({
    history: [],
    tools: [boom],
  });
  await expect(session.prompt('go')).rejects.toMatchObject({ kind: 'failed' });
});

it('does not run the next tool call after an abort', async () => {
  const { faux, models } = fauxModels();
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('stop', {}), fauxToolCall('later', {})], {
      stopReason: 'toolUse',
    }),
  ]);
  const ran: string[] = [];
  const session = createPiEngine({ models, model: faux.getModel(), apiKey: 'k' }).open({
    history: [],
    tools: [
      {
        name: 'stop',
        description: 'd',
        parameters: {},
        run: () => (session.abort(), Promise.resolve('x')),
      },
      {
        name: 'later',
        description: 'd',
        parameters: {},
        run: () => (ran.push('later'), Promise.resolve('x')),
      },
    ],
  });
  await expect(session.prompt('go')).rejects.toMatchObject({ kind: 'aborted' });
  expect(ran).toEqual([]);
});

it.each([
  ['429 rate_limit_error', true],
  ['529 overloaded_error', true],
  ['503 service unavailable', true],
  ['Overloaded', true],
  ['request timed out', true],
  ['fetch failed: ECONNRESET', true],
  ['400 invalid_request_error: prompt is too long: 512 tokens', false],
  ['401 invalid x-api-key', false],
  ['403 forbidden', false],
  ['404 model not found', false],
])('classifies %j as transient: %s', (message, transient) => {
  expect(isTransient(message)).toBe(transient);
});

it('a bad request is a failed error that never carries the key or the reason', async () => {
  const { faux, models } = fauxModels();
  faux.setResponses([
    fauxAssistantMessage([], { stopReason: 'error', errorMessage: '400 echoes sk-secret' }),
  ]);
  const session = createPiEngine({ models, model: faux.getModel(), apiKey: 'sk-secret' }).open({
    history: [],
  });
  const failure: unknown = await session.prompt('hi').catch((error: unknown) => error);
  expect(failure).toMatchObject({ kind: 'failed' });
  expect(failure instanceof Error ? failure.message : '').not.toContain('sk-secret');
});

it('rejects an unknown model id without echoing the key', () => {
  const run = (): unknown => createAnthropicEngine({ apiKey: 'sk-secret', modelId: 'nope' });
  expect(run).toThrow(/Unknown Anthropic model/);
  expect(run).not.toThrow(/sk-secret/);
});

it('uses the configured key even when ambient Anthropic tokens are set', async () => {
  vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'ambient-bearer');
  vi.stubEnv('ANTHROPIC_OAUTH_TOKEN', 'ambient-oauth');
  const models = createAnthropicModels('sk-configured');
  const auth = await models.getAuth('anthropic');
  expect(auth?.source).toBe('ANTHROPIC_API_KEY');
  expect(auth?.auth.apiKey).toBe('sk-configured');
  expect(auth?.auth.headers).toBeUndefined();
  vi.unstubAllEnvs();
});

it('builds the default Claude engine from the catalog', () => {
  const engine = createAnthropicEngine({ apiKey: 'sk-test', modelId: 'claude-sonnet-5-5' });
  expect(engine.open({ history: [] }).usage()).toEqual({
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
  });
});

it('hands a tool the model made up to the caller instead of failing', async () => {
  const { faux, models } = fauxModels();
  faux.setResponses([reply({ tool: 'made_up', args: { x: 1 } }), reply({ text: 'ok' })]);
  const seen: string[] = [];
  const unknownTool = (name: string): Promise<string> => {
    seen.push(name);
    return Promise.resolve('refused');
  };
  const engine = createPiEngine({ models, model: faux.getModel(), apiKey: 'k' });
  expect(await engine.open({ history: [], unknownTool }).prompt('go')).toBe('ok');
  expect(seen).toEqual(['made_up']);
});

it('passes the turn signal to a tool', async () => {
  const { faux, models } = fauxModels();
  faux.setResponses([reply({ tool: 'peek', args: {} }), reply({ text: 'ok' })]);
  let signal: AbortSignal | undefined;
  const peek = {
    name: 'peek',
    description: 'd',
    parameters: {},
    run: (_args: Record<string, unknown>, given?: AbortSignal) => {
      signal = given;
      return Promise.resolve('x');
    },
  };
  const engine = createPiEngine({ models, model: faux.getModel(), apiKey: 'k' });
  await engine.open({ history: [], tools: [peek] }).prompt('go');
  expect(signal?.aborted).toBe(false);
});

it('reports each model call as it returns, including a billed failure', async () => {
  const { faux, models } = fauxModels();
  faux.setResponses([
    reply({ tool: 'none', args: {} }),
    reply({ text: 'done' }),
    reply({ error: 'failed' }),
  ]);
  const calls: string[] = [];
  const engine = createPiEngine({ models, model: faux.getModel(), apiKey: 'k' });
  const onUsage = (call: { status: string }): void => {
    calls.push(call.status);
  };
  await engine.open({ history: [], onUsage }).prompt('go');
  await expect(engine.open({ history: [], onUsage }).prompt('again')).rejects.toThrow();
  expect(calls).toEqual(['ok', 'ok', 'failed']);
});

it('shows the model an earlier tool call and its result as real tool blocks', async () => {
  const { faux, models } = fauxModels();
  let seen: unknown[] = [];
  faux.setResponses([
    (context) => {
      seen = [...context.messages];
      return fauxAssistantMessage(fauxText('ok'));
    },
  ]);
  const history: EngineMessage[] = [
    { role: 'user', text: 'time?' },
    { role: 'assistant', text: '', toolCalls: [{ id: 'c1', name: 'clock_now', args: {} }] },
    { role: 'tool', text: 'noon', id: 'c1', name: 'clock_now', isError: false },
    { role: 'assistant', text: 'noon' },
  ];
  const session = createPiEngine({ models, model: faux.getModel(), apiKey: 'k' }).open({ history });
  await session.prompt('thanks');
  expect(seen).toMatchObject([
    { role: 'user' },
    { role: 'assistant', stopReason: 'toolUse', content: [{ type: 'toolCall', id: 'c1' }] },
    { role: 'toolResult', toolCallId: 'c1', isError: false },
    { role: 'assistant', stopReason: 'stop' },
    { role: 'user', content: 'thanks' },
  ]);
  expect(session.transcript().map((m) => m.role)).toEqual(['user', 'assistant']);
});

it('records the whole turn: the user, the tool call, its result and the answer', async () => {
  const { faux, models } = fauxModels();
  faux.setResponses([
    reply({ tool: 'echo', args: { a: 1 } }),
    fauxAssistantMessage(fauxText('hi')),
  ]);
  const echo = {
    name: 'echo',
    description: 'd',
    parameters: {},
    run: () => Promise.resolve('out'),
  };
  const session = createPiEngine({ models, model: faux.getModel(), apiKey: 'k' }).open({
    history: [],
    tools: [echo],
  });
  await session.prompt('go');
  const log = session.transcript();
  expect(log.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
  expect(log[1]).toMatchObject({ toolCalls: [{ name: 'echo', args: { a: 1 } }] });
  expect(log[2]).toMatchObject({ text: 'out', name: 'echo', isError: false });
  expect(log[3]).toEqual({ role: 'assistant', text: 'hi' });
});

it('sends Anthropic every tool_use id with a matching tool_result', async () => {
  const bodies: string[] = [];
  vi.stubGlobal('fetch', (_url: unknown, init?: { body?: unknown }) => {
    bodies.push(String(init?.body));
    return Promise.resolve(
      new Response('{"error":{"type":"invalid_request_error"}}', { status: 400 }),
    );
  });
  try {
    const history: EngineMessage[] = [
      { role: 'user', text: 'time?' },
      { role: 'assistant', text: '', toolCalls: [{ id: 'toolu_1', name: 'clock_now', args: {} }] },
      { role: 'tool', text: 'noon', id: 'toolu_1', name: 'clock_now', isError: false },
      { role: 'assistant', text: 'noon' },
      { role: 'user', text: 'again' },
      { role: 'assistant', text: '', toolCalls: [{ id: 'toolu_2', name: 'clock_now', args: {} }] },
      { role: 'tool', text: 'aborted', id: 'toolu_2', name: 'clock_now', isError: true },
      { role: 'assistant', text: '(turn stopped)' },
    ];
    const models = createAnthropicModels('k');
    const model = models.getModel('anthropic', 'claude-sonnet-5-5');
    if (model === undefined) throw new Error('model missing');
    const session = createPiEngine({ models, model, apiKey: 'k' }).open({ history });
    await session.prompt('now').catch(() => undefined);
    const block = z.object({
      type: z.string(),
      id: z.string().optional(),
      tool_use_id: z.string().optional(),
    });
    const sent = z
      .object({ messages: z.array(z.object({ content: z.union([z.string(), z.array(block)]) })) })
      .parse(JSON.parse(bodies[0] ?? '{}'));
    const blocks = sent.messages.flatMap((m) => (typeof m.content === 'string' ? [] : m.content));
    const uses = blocks.filter((b) => b.type === 'tool_use').map((b) => b.id);
    const results = blocks.filter((b) => b.type === 'tool_result').map((b) => b.tool_use_id);
    expect(uses).toEqual(['toolu_1', 'toolu_2']);
    expect(results).toEqual(uses);
  } finally {
    vi.unstubAllGlobals();
  }
});
