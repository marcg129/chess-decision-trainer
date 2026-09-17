import { describe, expect, it } from 'vitest';
import {
  chooseWeighted,
  opponentResponseWeight,
  quickRecallWeight,
} from './selectors';

describe('opening training selectors', () => {
  it('uses injected randomness deterministically', () => {
    const candidates = [
      { value: 'rare', weight: 4 },
      { value: 'common', weight: 1 },
    ];
    expect(chooseWeighted(candidates, () => 0)).toBe('rare');
    expect(chooseWeighted(candidates, () => 0.99)).toBe('common');
  });

  it('rejects empty or non-positive weighted candidate sets', () => {
    expect(() => chooseWeighted([], () => 0)).toThrow(/candidate/i);
    expect(() => chooseWeighted([{ value: 'none', weight: 0 }], () => 0)).toThrow(/weight/i);
  });

  it('keeps heavily practiced opponent branches selectable but lower weighted', () => {
    expect(opponentResponseWeight({ destinationAttempts: 0, sessionExposure: 0 }))
      .toBeGreaterThan(opponentResponseWeight({ destinationAttempts: 8, sessionExposure: 2 }));
    expect(opponentResponseWeight({ destinationAttempts: 100, sessionExposure: 10 })).toBeGreaterThan(0);
  });

  it('favors unseen, wrong, hinted, and slow positions', () => {
    const solid = quickRecallWeight({ attempts: 8, incorrect: 0, hintedAttempts: 0, slowAttempts: 0 });
    expect(quickRecallWeight({ attempts: 0, incorrect: 0, hintedAttempts: 0, slowAttempts: 0 })).toBeGreaterThan(solid);
    expect(quickRecallWeight({ attempts: 8, incorrect: 4, hintedAttempts: 0, slowAttempts: 0 })).toBeGreaterThan(solid);
    expect(quickRecallWeight({ attempts: 8, incorrect: 0, hintedAttempts: 4, slowAttempts: 0 })).toBeGreaterThan(solid);
    expect(quickRecallWeight({ attempts: 8, incorrect: 0, hintedAttempts: 0, slowAttempts: 4 })).toBeGreaterThan(solid);
  });
});
