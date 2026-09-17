import Dexie, { type Table } from 'dexie';
import type {
  LearnerProfile,
  MoveEdge,
  Position,
  PositionMastery,
  Repertoire,
  RepertoireMove,
  RepertoireMoveMastery,
  RepertoirePosition,
  TrainingAttempt,
  TrainingBackupV1,
  TrainingSession,
} from '../training/types';

export type LocalBackupRecord = {
  id: string;
  createdAt: string;
  reason: 'pre-restore';
  backup: TrainingBackupV1;
};

export const V1_STORES = {
  learnerProfiles: '&id, updatedAt',
  repertoires: '&id, learnerId, [learnerId+archived], updatedAt',
  positions: '&id, &positionKey, sideToMove, updatedAt',
  moveEdges: '&id, &[fromPositionId+moveKey], fromPositionId, toPositionId',
  repertoirePositions: '&id, &[repertoireId+positionId], repertoireId, positionId',
  repertoireMoves: '&id, &[repertoireId+moveEdgeId], repertoireId, moveEdgeId, role',
  positionMastery: '&id, &positionId, lastSeenAt',
  repertoireMoveMastery: '&id, &repertoireMoveId, lastAttemptedAt',
  trainingSessions: '&id, repertoireId, startedAt',
  trainingAttempts: '&id, timestamp, repertoireId, positionId, sessionId',
} as const;

export const V2_STORES = {
  ...V1_STORES,
  localBackups: '&id, createdAt, reason',
} as const;

export class ChessTrainingDatabase extends Dexie {
  learnerProfiles!: Table<LearnerProfile, string>;
  repertoires!: Table<Repertoire, string>;
  positions!: Table<Position, string>;
  moveEdges!: Table<MoveEdge, string>;
  repertoirePositions!: Table<RepertoirePosition, string>;
  repertoireMoves!: Table<RepertoireMove, string>;
  positionMastery!: Table<PositionMastery, string>;
  repertoireMoveMastery!: Table<RepertoireMoveMastery, string>;
  trainingSessions!: Table<TrainingSession, string>;
  trainingAttempts!: Table<TrainingAttempt, string>;
  localBackups!: Table<LocalBackupRecord, string>;

  constructor(name = 'chess-decision-trainer') {
    super(name);
    this.version(1).stores(V1_STORES);
    this.version(2).stores(V2_STORES);
  }
}
