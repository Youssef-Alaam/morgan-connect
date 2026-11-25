import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  type FauxResponseStep,
} from '@earendil-works/pi-ai';
import { expect, it, vi } from 'vitest';
import { describeEngineContract } from '../../test/helpers/engine-contract.js';
import type { Step } from '../../test/helpers/fake-engine.js';
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
