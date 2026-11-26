import type { ToolDefinition } from './registry.js';

/** A harmless tool that needs approval, so the Approve and Deny buttons can be tried safely. */
export function createDemoGatedTool(): ToolDefinition {
  return {
    name: 'demo.gated',
    description:
      'A test action that changes nothing real but needs the owner to approve it first. Takes a short note and repeats it.',
    parameters: {
      type: 'object',
      properties: { note: { type: 'string', description: 'A short note to repeat back' } },
      required: ['note'],
    },
    actionType: 'overwrite',
    changesState: true,
    run: (args) => {
      const note = typeof args['note'] === 'string' ? args['note'].slice(0, 200) : '(no note)';
      return Promise.resolve(`demo.gated ran with the note: ${note}`);
    },
  };
}
