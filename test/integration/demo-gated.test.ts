import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
} from '@earendil-works/pi-ai';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDb, migrateToLatest, type Db } from '../../src/data/index.js';
import { createApprovals, createGate, createPiEngine } from '../../src/policy/index.js';
import { linkChats } from '../helpers/link-chats.js';
import { startPostgres, type TestPostgres } from '../helpers/postgres.js';

let postgres: TestPostgres;
let db: Db;

beforeAll(async () => {
  postgres = await startPostgres();
  db = createDb(postgres.url);
  await migrateToLatest(db);
  await linkChats(db, ['chat']);
}, 180_000);

afterAll(async () => {
  await db.destroy();
  await postgres.stop();
});

it('demo.gated runs on the Pi engine only after Approve, and the model sees the result', async () => {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall('demo_gated', { note: 'via pi' }), { stopReason: 'toolUse' }),
    fauxAssistantMessage(fauxText('finished')),
  ]);
  const engine = createPiEngine({ models, model: faux.getModel(), apiKey: 'k' });
  const caller = { channel: 'fake', chatId: 'chat' };
  const approvals = createApprovals({
    db,
    ttlMs: 60_000,
    prompt: ({ id }) => {
      void approvals.decide(id, 'approved', caller);
      return Promise.resolve();
    },
  });
  const gate = createGate({ db, demo: true, approvals });
  const session = engine.open({ history: [], tools: gate.toolsFor(caller) });
  expect(await session.prompt('please')).toBe('finished');
  const result = session.transcript().find((m) => m.role === 'tool');
  expect(result).toMatchObject({
    isError: false,
    text: expect.stringContaining('via pi') as string,
  });
});
