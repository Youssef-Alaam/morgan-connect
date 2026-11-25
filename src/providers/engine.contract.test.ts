import { describeEngineContract } from '../../test/helpers/engine-contract.js';
import { ScriptedEngine } from '../../test/helpers/fake-engine.js';
import { startFakeEngineServer } from '../../test/helpers/fake-engine-server.js';
import { createHttpEngine } from './http.js';

describeEngineContract('scripted fake', (script) => new ScriptedEngine(script));

describeEngineContract(
  'http engine against a fake server',
  async (script) => {
    const server = await startFakeEngineServer(script);
    return createHttpEngine({ url: server.url, token: 'secret' });
  },
  { tools: false },
);
