import { describe, expect, it } from 'vitest';
import { parsePgnSource } from '../pgn/parsePgn';
import { buildRepertoireImportPlan } from './buildImportPlan';

describe('buildRepertoireImportPlan trainable content', () => {
  it('rejects an import that contains no trainable learner move for the selected side', () => {
    const document = parsePgnSource(`
[Event "No black reply"]
[Result "*"]
1. e4 *
`);

    expect(() => buildRepertoireImportPlan(document, {
      name: 'No black training',
      side: 'black',
      selectedGameIndexes: [0],
    })).toThrow(/trainable|learner move/i);
  });
});
