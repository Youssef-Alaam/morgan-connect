import { describe, expect, it } from 'vitest';
import { EngineError, type Engine, type EngineTool } from '../../src/policy/index.js';
import type { Step } from './fake-engine.js';

const tool = (log: string[], toolName: string): EngineTool => ({
  name: toolName,
  description: 'test tool',
  parameters: { type: 'object', properties: {} },
  run: (args) => {
    log.push(`${toolName}:${JSON.stringify(args)}`);
    return Promise.resolve('ok');
  },
});

/** The behaviour every engine adapter must show, run against any engine that replays `Step`s. */
export function describeEngineContract(name: string, make: (script: Step[]) => Engine): void {
  describe(`engine contract: ${name}`, () => {
    it('answers a prompt and reports usage', async () => {
      const session = make([{ text: 'hello' }]).open({ history: [] });
      expect(await session.prompt('hi')).toBe('hello');
      expect(session.usage().outputTokens).toBeGreaterThan(0);
    });

    it('runs a scripted two-step tool call in order, then answers', async () => {
      const log: string[] = [];
      const script: Step[] = [
        { tool: 'first', args: { n: 1 } },
        { tool: 'second', args: { n: 2 } },
        { text: 'done' },
      ];
      const tools = [tool(log, 'first'), tool(log, 'second')];
      const session = make(script).open({ history: [], tools });
      expect(await session.prompt('go')).toBe('done');
      expect(log).toEqual(['first:{"n":1}', 'second:{"n":2}']);
    });

    it('shows a steer message to the model before its next step', async () => {
      const script: Step[] = [{ tool: 'first', args: {} }, { echoSteer: true }];
      const session = make(script).open({ history: [], tools: [tool([], 'first')] });
      session.steer('shorter please');
      expect(await session.prompt('hi')).toBe('shorter please');
    });

    it('raises a transient error for a model hiccup', async () => {
      const session = make([{ error: 'transient' }]).open({ history: [] });
      await expect(session.prompt('hi')).rejects.toMatchObject({ kind: 'transient' });
    });

    it('raises a failed error, not a retryable one, for a bad request', async () => {
      const session = make([{ error: 'failed' }]).open({ history: [] });
      await expect(session.prompt('hi')).rejects.toMatchObject({ kind: 'failed' });
    });

    it('stops with an aborted error after abort', async () => {
      const session = make([{ text: 'never' }]).open({ history: [] });
      session.abort();
      const failure: unknown = await session.prompt('hi').catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(EngineError);
      expect(failure).toMatchObject({ kind: 'aborted' });
    });
  });
}
