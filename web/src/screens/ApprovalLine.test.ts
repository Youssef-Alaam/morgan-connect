import { describe, expect, it } from 'vitest';
import { splitQuestion } from './ApprovalLine.tsx';

describe('splitQuestion', () => {
  it('keeps everything after the first line as the arguments, unchanged', () => {
    const args = '{\n  "a": "x\ny",\n  "b": 2\n}';
    expect(splitQuestion(`Morgan wants to use t (create):\n${args}`)).toEqual({
      what: 'Morgan wants to use t (create):',
      args,
    });
  });

  it('shows a one-line question as the description alone', () => {
    expect(splitQuestion('Send it?')).toEqual({ what: 'Send it?' });
  });
});
