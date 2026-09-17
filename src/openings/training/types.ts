import type {
  EntityId,
  MoveEdge,
  Position,
  RepertoireMove,
} from '../../training/types';

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

export type OpeningTrainingMode = 'practice-line' | 'quick-recall';

export type PromptPhase =
  | 'awaiting-move'
  | 'retry'
  | 'revealed'
  | 'resolved-not-persisted'
  | 'complete';

export type OpeningTrainingFeedback = {
  kind: 'preferred' | 'alternative' | 'incorrect' | 'revealed' | 'storage-error';
  message: string;
  preferredSan?: string;
  explanation?: string;
  decisionTimeMs?: number;
  speed?: SpeedFeedback;
};

export type OpeningTrainingState = {
  mode: OpeningTrainingMode;
  repertoireId: EntityId;
  repertoireName: string;
  learnerSide: 'w' | 'b';
  fen: string;
  phase: PromptPhase;
  progress: { completed: number; total: number | null };
  hintCount: number;
  hintText?: string;
  feedback?: OpeningTrainingFeedback;
  complete: boolean;
};
