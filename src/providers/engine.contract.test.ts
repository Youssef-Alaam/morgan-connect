import { describeEngineContract } from '../../test/helpers/engine-contract.js';
import { ScriptedEngine } from '../../test/helpers/fake-engine.js';

describeEngineContract('scripted fake', (script) => new ScriptedEngine(script));
