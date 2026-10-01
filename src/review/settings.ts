import type { ReviewSettings } from './types';

export const DEFAULT_REVIEW_SETTINGS: ReviewSettings = {
  newItemsPerDay: 10,
  batchSize: 15,
};

function integerInRange(
  value: number,
  min: number,
  max: number,
  label: string,
): number {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer.`);
  }
  if (value < min || value > max) {
    throw new Error(`${label} must be between ${min} and ${max}.`);
  }
  return value;
}

export function normalizeReviewSettings(
  input: Partial<ReviewSettings> = {},
): ReviewSettings {
  return {
    newItemsPerDay: integerInRange(
      input.newItemsPerDay ?? DEFAULT_REVIEW_SETTINGS.newItemsPerDay,
      0,
      100,
      'New items per day',
    ),
    batchSize: integerInRange(
      input.batchSize ?? DEFAULT_REVIEW_SETTINGS.batchSize,
      1,
      100,
      'Batch size',
    ),
  };
}
