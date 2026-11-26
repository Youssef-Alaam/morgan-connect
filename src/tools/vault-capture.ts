import type { ToolDefinition } from './registry.js';
import { VaultError, type Vault } from './vault.js';

const MAX_TEXT = 2000;
const PATH_DATE = /^_inbox\/(\d{4}-\d{2}-\d{2})-/;

/** The note as it lands in the vault: frontmatter Morgan writes, then the captured text. */
function noteFor(path: string, text: string): string {
  const created = PATH_DATE.exec(path)?.[1] ?? '';
  return `---\ntype: capture\nstatus: inbox\ncreated: ${created}\n---\n\n${text.trim()}\n`;
}

/** Adds one new note to the vault's `_inbox/` as one commit. It never overwrites and never leaves `_inbox/`. */
export function createVaultCaptureTool(vault: Vault): ToolDefinition {
  return {
    name: 'vault.capture',
    description:
      'Save a note to the owner\u2019s vault inbox as one new file. The owner approves the path and text first. ' +
      'Takes `path` like _inbox/YYYY-MM-DD-short-slug.md (today\u2019s date, lowercase slug) and `text`. ' +
      'It never overwrites an existing note.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'For example _inbox/2026-11-26-call-notes.md' },
        text: { type: 'string', maxLength: MAX_TEXT, description: 'The note to save' },
      },
      required: ['path', 'text'],
    },
    actionType: 'overwrite',
    changesState: true,
    run: async (args) => {
      const { path, text } = args;
      if (typeof path !== 'string' || typeof text !== 'string' || text.trim() === '') {
        throw new VaultError('refused', 'Give a path and some text to save');
      }
      if (text.length > MAX_TEXT) throw new VaultError('refused', 'The text is too long');
      const done = await vault.capture(path, noteFor(path, text));
      return `Saved ${done.path}. Commit: ${done.url ?? done.sha}`;
    },
  };
}
