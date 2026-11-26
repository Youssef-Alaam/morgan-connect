import { expect, it, vi } from 'vitest';
import { createVaultCaptureTool } from './vault-capture.js';
import { VaultError, type Vault } from './vault.js';

const PATH = '_inbox/2026-11-26-idea.md';
const fakeVault = (): Vault => ({
  capture: vi.fn(() => Promise.resolve({ path: PATH, sha: 'abc123' })),
});

it('is a gated, state-changing tool', () => {
  expect(createVaultCaptureTool(fakeVault())).toMatchObject({
    name: 'vault.capture',
    actionType: 'overwrite',
    changesState: true,
  });
});

it('saves the text under frontmatter and reports the commit, not the text', async () => {
  const vault = fakeVault();
  const answer = await createVaultCaptureTool(vault).run({ path: PATH, text: ' buy milk \n' });
  expect(vault.capture).toHaveBeenCalledWith(
    PATH,
    '---\ntype: capture\nstatus: inbox\ncreated: 2026-11-26\n---\n\nbuy milk\n',
  );
  expect(answer).toBe(`Saved ${PATH}. Commit: abc123`);
});

it('prefers the commit link when the vault gives one', async () => {
  const vault: Vault = {
    capture: () =>
      Promise.resolve({ path: PATH, sha: 'abc', url: 'https://github.com/o/r/commit/abc' }),
  };
  expect(await createVaultCaptureTool(vault).run({ path: PATH, text: 'x' })).toContain(
    'https://github.com/o/r/commit/abc',
  );
});

it.each([{}, { path: PATH }, { path: PATH, text: '  ' }, { path: 5, text: 'x' }])(
  'refuses bad arguments %j without touching the vault',
  async (args) => {
    const vault = fakeVault();
    await expect(createVaultCaptureTool(vault).run(args)).rejects.toBeInstanceOf(VaultError);
    expect(vault.capture).not.toHaveBeenCalled();
  },
);

it('refuses text over the limit', async () => {
  const vault = fakeVault();
  await expect(
    createVaultCaptureTool(vault).run({ path: PATH, text: 'x'.repeat(2001) }),
  ).rejects.toThrow('too long');
});
