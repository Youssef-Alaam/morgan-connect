import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  type FauxResponseStep,
} from '@earendil-works/pi-ai';
import { expect, it } from 'vitest';
import { describeEngineContract } from '../../test/helpers/engine-contract.js';
import type { Step } from '../../test/helpers/fake-engine.js';
import { createAnthropicEngine, createPiEngine } from './pi.js';

type Scripted = Exclude<Step, { hang: true }>;

const reply = (step: Scripted): FauxResponseStep => {
  if ('tool' in step) {
    return fauxAssistantMessage(fauxToolCall(step.tool, step.args as never), {
      stopReason: 'toolUse',
    });
  }
  if ('text' in step) return fauxAssistantMessage(fauxText(step.text));
  const errorMessage = step.error === 'failed' ? '401 invalid x-api-key' : 'overloaded';
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

it('sends history and the system prompt, and tells the model about an unknown tool', async () => {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const seen: string[] = [];
  faux.setResponses([
    reply({ tool: 'missing', args: {} }),
    (context) => {
      seen.push(JSON.stringify(context.messages.map((m) => m.role)));
      return fauxAssistantMessage(fauxText('ok'));
    },
  ]);
  const engine = createPiEngine({
    models,
    model: faux.getModel(),
    apiKey: 'k',
    system: 'be brief',
  });
  const history = [
    { role: 'user', text: 'earlier' },
    { role: 'assistant', text: 'earlier answer' },
  ] as const;
  const session = engine.open({ history, system: 'be very brief' });
  expect(await session.prompt('now')).toBe('ok');
  expect(seen[0]).toContain('"toolResult"');
  expect(seen[0]).toContain('"assistant"');
});

it('rejects an unknown model id without echoing the key', () => {
  expect(() => createAnthropicEngine({ apiKey: 'sk-secret', modelId: 'nope' })).toThrow(
    /Unknown Anthropic model/,
  );
});

it('builds the default Claude engine from the catalog', () => {
  const engine = createAnthropicEngine({ apiKey: 'sk-test', modelId: 'claude-sonnet-5-5' });
  expect(engine.open({ history: [] }).usage()).toEqual({
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
  });
});
