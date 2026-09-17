import { describe, expect, it } from 'vitest';
import { parsePgnSource } from '../pgn/parsePgn';
import { buildRepertoireImportPlan } from './buildImportPlan';

describe('buildRepertoireImportPlan', () => {
  it('merges selected games, preserves comments/variations, and assigns roles', () => {
    const doc = parsePgnSource(`
[Event "A"]
[Result "*"]
1. e4 {Claim the center} e5 (1... c5 2. Nf3 d6) 2. Nf3 Nc6 *

[Event "B"]
[Result "*"]
1. e4 e6 2. d4 d5 *
`);
    const plan = buildRepertoireImportPlan(doc, {
      name: 'White starter', side: 'white', selectedGameIndexes: [0, 1],
    });

    expect(plan.counts.games).toBe(2);
    expect(plan.transitions.some((item) => item.role === 'learner' && item.explanation === 'Claim the center')).toBe(true);
    expect(plan.transitions.some((item) => item.role === 'opponent')).toBe(true);
    expect(plan.transitions.some((item) => item.fromFen.includes(' b ') && item.move.to === 'c5')).toBe(true);
  });

  it('marks the local main learner continuation inside an opponent variation as preferred', () => {
    const doc = parsePgnSource(`
[Event "Variation"]
[Result "*"]
1. e4 e5 (1... c5 2. Nf3 d6) 2. Nf3 *
`);
    const plan = buildRepertoireImportPlan(doc, {
      name: 'Variation preference', side: 'white', selectedGameIndexes: [0],
    });
    const c5Response = plan.transitions.find((item) => item.move.from === 'g1' && item.move.to === 'f3' && item.fromFen.includes(' c5 '));
    expect(c5Response).toMatchObject({ role: 'learner', preferred: true, trainable: true });
  });

  it('keeps exactly one preferred learner move and warns on conflicting main lines', () => {
    const doc = parsePgnSource(`
[Event "First"]
[Result "*"]
1. e4 e5 2. Nf3 *

[Event "Second"]
[Result "*"]
1. d4 d5 2. c4 *
`);
    const plan = buildRepertoireImportPlan(doc, {
      name: 'White choices', side: 'white', selectedGameIndexes: [0, 1],
    });
    const rootLearnerMoves = plan.transitions.filter((item) => item.role === 'learner' && item.fromFen === plan.rootFen);
    expect(rootLearnerMoves.filter((item) => item.preferred)).toHaveLength(1);
    expect(rootLearnerMoves.find((item) => item.preferred)?.move.to).toBe('e4');
    expect(plan.warnings.some((warning) => warning.code === 'preferred-move-conflict')).toBe(true);
  });

  it('rejects selected games with different root positions', () => {
    const doc = parsePgnSource(`
[Event "Start"]
[Result "*"]
1. e4 *

[Event "Custom"]
[SetUp "1"]
[FEN "8/8/8/8/8/8/4K3/6k1 w - - 0 1"]
[Result "*"]
1. Kf3 *
`);
    expect(() => buildRepertoireImportPlan(doc, {
      name: 'Bad roots', side: 'white', selectedGameIndexes: [0, 1],
    })).toThrow(/same root/i);
  });
});
