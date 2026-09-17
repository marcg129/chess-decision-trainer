import type { TrainingMoveInput } from '../../training/types';

export type ImportSide = 'white' | 'black';

export type PlannedRepertoireTransition = {
  fromFen: string;
  move: TrainingMoveInput;
  role: 'learner' | 'opponent' | 'alternative';
  preferred: boolean;
  trainable: boolean;
  order: number;
  explanation?: string;
};

export type ImportWarning = {
  code: 'preferred-move-conflict' | 'parser-warning';
  message: string;
  gameIndexes: number[];
};

export type RepertoireImportPlan = {
  name: string;
  side: ImportSide;
  rootFen: string;
  rootPositionKey: string;
  selectedGameIndexes: number[];
  transitions: PlannedRepertoireTransition[];
  warnings: ImportWarning[];
  counts: {
    games: number;
    positions: number;
    moves: number;
  };
};
