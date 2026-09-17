import type { MoveEdge, Position, RepertoireMove } from '../../training/types';

export type OpeningMoveChoice = {
  repertoireMove: RepertoireMove;
  moveEdge: MoveEdge;
  toPosition: Position;
};

export type SpeedFeedback = {
  targetMs: number;
  status: 'good' | 'slow';
  label: string;
};
