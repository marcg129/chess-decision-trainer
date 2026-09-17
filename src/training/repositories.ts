import type {
  EntityId,
  LearnerProfile,
  MoveEdge,
  Position,
  PositionMastery,
  Repertoire,
  RepertoireMove,
  RepertoireMoveMastery,
  RepertoireMoveRole,
  RepertoirePosition,
  TrainingAttempt,
  TrainingBackupV1,
  TrainingDataSummary,
  TrainingMoveInput,
  TrainingSession,
} from './types';

export type RepertoireTransitionInput = {
  repertoireId: EntityId;
  fromFen: string;
  move: TrainingMoveInput;
  role: RepertoireMoveRole;
  preferred: boolean;
  trainable: boolean;
  order?: number;
  explanation?: string;
};

export type CreateRepertoireImportInput = {
  repertoire: Repertoire;
  transitions: RepertoireTransitionInput[];
};

export type RepertoireTrainingSnapshot = {
  repertoire: Repertoire;
  positions: Position[];
  moveEdges: MoveEdge[];
  repertoirePositions: RepertoirePosition[];
  repertoireMoves: RepertoireMove[];
  positionMastery: PositionMastery[];
  repertoireMoveMastery: RepertoireMoveMastery[];
  attempts: TrainingAttempt[];
};

export type RecordAttemptInput = Omit<
  TrainingAttempt,
  'id' | 'masteryBefore' | 'masteryAfter'
> & { attemptId?: EntityId };

export interface TrainingRepository {
  ensureLocalLearner(displayName?: string): Promise<LearnerProfile>;
  saveRepertoire(repertoire: Repertoire): Promise<void>;
  listRepertoires(learnerId: EntityId): Promise<Repertoire[]>;
  getRepertoire(repertoireId: EntityId): Promise<Repertoire | undefined>;
  createRepertoireFromTransitions(input: CreateRepertoireImportInput): Promise<void>;
  loadRepertoireTrainingSnapshot(repertoireId: EntityId): Promise<RepertoireTrainingSnapshot>;
  completeSession(sessionId: EntityId, completedAt: string): Promise<void>;
  upsertRepertoireTransition(input: RepertoireTransitionInput): Promise<{
    fromPosition: Position;
    toPosition: Position;
    moveEdge: MoveEdge;
    repertoirePosition: RepertoirePosition;
    repertoireMove: RepertoireMove;
  }>;
  getPositionByKey(positionKey: string): Promise<Position | undefined>;
  getPositionMastery(positionId: EntityId): Promise<PositionMastery | undefined>;
  getRepertoireMoveMastery(
    repertoireMoveId: EntityId,
  ): Promise<RepertoireMoveMastery | undefined>;
  recordAttempt(input: RecordAttemptInput): Promise<TrainingAttempt>;
  createSession(session: TrainingSession): Promise<void>;
}

export interface TrainingAdminRepository {
  getSummary(): Promise<TrainingDataSummary>;
  exportBackup(): Promise<TrainingBackupV1>;
  restoreBackup(backup: TrainingBackupV1): Promise<void>;
  getLatestPreRestoreBackup(): Promise<TrainingBackupV1 | null>;
  resetTrainingData(): Promise<LearnerProfile>;
}
