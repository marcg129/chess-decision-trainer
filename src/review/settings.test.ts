import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REVIEW_SETTINGS,
  normalizeReviewSettings,
} from './settings';

describe('review settings', () => {
  it('uses the Phase 4 defaults', () => {
    expect(normalizeReviewSettings()).toEqual({
      newItemsPerDay: 10,
      batchSize: 15,
    });
    expect(DEFAULT_REVIEW_SETTINGS).toEqual({
      newItemsPerDay: 10,
      batchSize: 15,
    });
  });

  it.each([0, 100])('accepts newItemsPerDay boundary %s', (newItemsPerDay) => {
    expect(normalizeReviewSettings({ newItemsPerDay }).newItemsPerDay).toBe(newItemsPerDay);
  });

  it.each([-1, 101])('rejects newItemsPerDay outside range: %s', (newItemsPerDay) => {
    expect(() => normalizeReviewSettings({ newItemsPerDay })).toThrow(/new items/i);
  });

  it.each([1, 100])('accepts batchSize boundary %s', (batchSize) => {
    expect(normalizeReviewSettings({ batchSize }).batchSize).toBe(batchSize);
  });

  it.each([0, 101])('rejects batchSize outside range: %s', (batchSize) => {
    expect(() => normalizeReviewSettings({ batchSize })).toThrow(/batch size/i);
  });

  it('rejects non-integer settings', () => {
    expect(() => normalizeReviewSettings({ newItemsPerDay: 1.5 })).toThrow(/integer/i);
    expect(() => normalizeReviewSettings({ batchSize: 2.5 })).toThrow(/integer/i);
  });
});
