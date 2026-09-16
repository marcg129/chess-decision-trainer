import type { Move } from 'chess.js';
import type { GameSnapshot } from './game';
import type { MoveDecisionRecord } from './trainingTypes';

export function createMoveDecisionRecord(input: {
  ply: number;
  move: Move;
  before: GameSnapshot;
  after: GameSnapshot;
  timing: { decisionTimeMs: number | null; clockAfterMs: number | null };
}): MoveDecisionRecord {
  const { ply, move, before, after, timing } = input;
  return {
    ply,
    mover: move.color,
    san: move.san,
    lan: move.lan,
    from: move.from,
    to: move.to,
    promotion: move.promotion,
    fenBefore: before.fen,
    positionKeyBefore: before.positionKey,
    fenAfter: after.fen,
    positionKeyAfter: after.positionKey,
    decisionTimeMs: timing.decisionTimeMs,
    clockAfterMs: timing.clockAfterMs,
  };
}
