import { describe, expect, it } from 'vitest';
import { getSpeedFeedback } from './speed';

describe('getSpeedFeedback', () => {
  it('uses the 5 second soft target by default', () => {
    expect(getSpeedFeedback(3_800)).toEqual({
      targetMs: 5_000,
      status: 'good',
      label: 'Good speed',
    });
    expect(getSpeedFeedback(8_400)).toEqual({
      targetMs: 5_000,
      status: 'slow',
      label: 'Target under 5s',
    });
  });

  it('supports an explicit positive target', () => {
    expect(getSpeedFeedback(2_000, 1_500)).toEqual({
      targetMs: 1_500,
      status: 'slow',
      label: 'Target under 1.5s',
    });
  });
});
