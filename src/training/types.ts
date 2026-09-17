import type { Square } from 'chess.js';

export type EntityId = string;
export type IsoTimestamp = string;
export type RepertoireSide = 'white' | 'black' | 'mixed';
export type RepertoireMoveRole = 'learner' | 'opponent' | 'alternative';
export type MasteryState = 'new' | 'learning' | 'familiar' | 'mastered';

export type TrainingMoveInput = {
  from: Square;
  to: Square;
  promotion?: 'q' | 'r' | 'b' | 'n';
};

export type LearnerProfile = {
  id: EntityId;
  displayName: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
};

export type Position = {
  id: EntityId;
  positionKey: string;
  fen: string;
  sideToMove: 'w' | 'b';
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
};

export type MoveEdge = {
  id: EntityId;
  fromPositionId: EntityId;
  toPositionId: EntityId;
  moveKey: string;
  from: Square;
  to: Square;
  promotion?: 'q' | 'r' | 'b' | 'n';
  san: string;
  createdAt: IsoTimestamp;
};

export type Repertoire = {
  id: EntityId;
  learnerId: EntityId;
  name: string;
  side: RepertoireSide;
  description?: string;
  archived: boolean;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
};

export type RepertoirePosition = {
  id: EntityId;
  repertoireId: EntityId;
  positionId: EntityId;
  trainable: boolean;
  notes?: string;
  tags: string[];
  priority?: number;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
};

export type RepertoireMove = {
  id: EntityId;
  repertoireId: EntityId;
  moveEdgeId: EntityId;
  role: RepertoireMoveRole;
  preferred: boolean;
  order?: number;
  explanation?: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
};

export type PositionMastery = {
  id: EntityId;
  positionId: EntityId;
  attempts: number;
  correct: number;
  incorrect: number;
  averageDecisionTimeMs: number | null;
  lastSeenAt: IsoTimestamp | null;
  state: MasteryState;
  score: number;
  nextReviewAt: IsoTimestamp | null;
  schedulingData: Record<string, unknown> | null;
  updatedAt: IsoTimestamp;
};

export type RepertoireMoveMastery = {
  id: EntityId;
  repertoireMoveId: EntityId;
  attempts: number;
  correct: number;
  incorrect: number;
  streak: number;
  averageDecisionTimeMs: number | null;
  lastAttemptedAt: IsoTimestamp | null;
  state: MasteryState;
  score: number;
  nextReviewAt: IsoTimestamp | null;
  schedulingData: Record<string, unknown> | null;
  updatedAt: IsoTimestamp;
};

export type TrainingSession = {
  id: EntityId;
  repertoireId?: EntityId;
  mode: string;
  startedAt: IsoTimestamp;
  completedAt?: IsoTimestamp;
};

export type AttemptMasterySnapshot = {
  positionState: MasteryState;
  positionScore: number;
  repertoireMoveState?: MasteryState;
  repertoireMoveScore?: number;
};

export type TrainingAttempt = {
  id: EntityId;
  timestamp: IsoTimestamp;
  sessionId?: EntityId;
  repertoireId: EntityId;
  positionId: EntityId;
  repertoireMoveId?: EntityId;
  expectedMove: string;
  actualMove: string;
  correct: boolean;
  decisionTimeMs: number;
  hintCount: number;
  hintUsed: boolean;
  mode: string;
  masteryBefore: AttemptMasterySnapshot;
  masteryAfter: AttemptMasterySnapshot;
};

export type RepertoireSummary = {
  id: EntityId;
  name: string;
  side: RepertoireSide;
  archived: boolean;
  positions: number;
  moves: number;
  attempts: number;
};

export type TrainingDataSummary = {
  learner: LearnerProfile;
  repertoires: RepertoireSummary[];
  counts: {
    repertoires: number;
    positions: number;
    moveEdges: number;
    positionMastery: number;
    repertoireMoveMastery: number;
    sessions: number;
    attempts: number;
  };
  lastActivityAt: IsoTimestamp | null;
  schemaVersion: number;
};

export type TrainingBackupV1 = {
  format: 'chess-decision-trainer';
  version: 1;
  exportedAt: IsoTimestamp;
  schemaVersion: number;
  data: {
    learnerProfiles: LearnerProfile[];
    repertoires: Repertoire[];
    positions: Position[];
    moveEdges: MoveEdge[];
    repertoirePositions: RepertoirePosition[];
    repertoireMoves: RepertoireMove[];
    positionMastery: PositionMastery[];
    repertoireMoveMastery: RepertoireMoveMastery[];
    trainingSessions: TrainingSession[];
    trainingAttempts: TrainingAttempt[];
  };
};

export const createId = (): EntityId => crypto.randomUUID();
