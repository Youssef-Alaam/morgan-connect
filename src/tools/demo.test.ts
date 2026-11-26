import { expect, it } from 'vitest';
import { createDemoGatedTool } from './demo.js';

it('is a state-changing tool that repeats a short note', async () => {
  const tool = createDemoGatedTool();
  expect(tool).toMatchObject({ name: 'demo.gated', actionType: 'overwrite', changesState: true });
  expect(await tool.run({ note: 'hello' })).toContain('hello');
  expect(await tool.run({ note: 'x'.repeat(500) })).toHaveLength(
    'demo.gated ran with the note: '.length + 200,
  );
  expect(await tool.run({})).toContain('(no note)');
});
