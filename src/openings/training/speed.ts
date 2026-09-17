import type { SpeedFeedback } from './types';

const DEFAULT_TARGET_MS = 5_000;

function formatSeconds(ms: number): string {
  const seconds = ms / 1_000;
  return Number.isInteger(seconds) ? `${seconds}s` : `${Number(seconds.toFixed(1))}s`;
}

export function getSpeedFeedback(
  decisionTimeMs: number,
  targetMs = DEFAULT_TARGET_MS,
): SpeedFeedback {
  if (!Number.isFinite(decisionTimeMs) || decisionTimeMs < 0) {
    throw new Error('Decision time must be a non-negative finite number.');
  }
  if (!Number.isFinite(targetMs) || targetMs <= 0) {
    throw new Error('Speed target must be a positive finite number.');
  }

  if (decisionTimeMs <= targetMs) {
    return { targetMs, status: 'good', label: 'Good speed' };
  }
  return {
    targetMs,
    status: 'slow',
    label: `Target under ${formatSeconds(targetMs)}`,
  };
}
