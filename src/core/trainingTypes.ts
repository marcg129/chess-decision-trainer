import type { Color } from 'chess.js';

export type MoveDecisionRecord = {
  ply: number;
  mover: Color;
  san: string;
  lan: string;
  from: string;
  to: string;
  promotion?: string;
  fenBefore: string;
  positionKeyBefore: string;
  fenAfter: string;
  positionKeyAfter: string;
  decisionTimeMs: number | null;
  clockAfterMs: number | null;
};
