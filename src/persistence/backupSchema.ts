import { z } from 'zod';
import { positionKeyFromFen } from '../core/positionIdentity';
import { parseFsrsSchedulingEnvelope } from '../review/fsrsAdapter';
import { InvalidChessEdgeError } from '../training/errors';
import { deriveTransition } from '../training/graph';
import type {
  TrainingBackup,
  TrainingBackupV1,
  TrainingBackupV2,
} from '../training/types';
import {
  InvalidBackupError,
  ReferentialIntegrityError,
  UnsupportedBackupVersionError,
} from './errors';

export const BACKUP_FORMAT = 'chess-decision-trainer' as const;
export const BACKUP_VERSION_V1 = 1 as const;
export const BACKUP_VERSION = 2 as const;

const uuidSchema = z.string().uuid();
const timestampSchema = z.string().min(1);
const squareSchema = z.string().regex(/^[a-h][1-8]$/);
const promotionSchema = z.enum(['q', 'r', 'b', 'n']);
const masteryStateSchema = z.enum(['new', 'learning', 'familiar', 'mastered']);

const reviewSettingsSchema = z.object({
  newItemsPerDay: z.number().int().min(0).max(100),
  batchSize: z.number().int().min(1).max(100),
});

const learnerProfileV1Schema = z.object({
  id: uuidSchema,
  displayName: z.string(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

const learnerProfileV2Schema = learnerProfileV1Schema.extend({
  reviewSettings: reviewSettingsSchema,
});

const repertoireSchema = z.object({
  id: uuidSchema,
  learnerId: uuidSchema,
  name: z.string(),
  side: z.enum(['white', 'black', 'mixed']),
  description: z.string().optional(),
  archived: z.boolean(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

const positionSchema = z.object({
  id: uuidSchema,
  positionKey: z.string().min(1),
  fen: z.string().min(1),
  sideToMove: z.enum(['w', 'b']),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

const moveEdgeSchema = z.object({
  id: uuidSchema,
  fromPositionId: uuidSchema,
  toPositionId: uuidSchema,
  moveKey: z.string().min(4),
  from: squareSchema,
  to: squareSchema,
  promotion: promotionSchema.optional(),
  san: z.string().min(1),
  createdAt: timestampSchema,
});

const repertoirePositionSchema = z.object({
  id: uuidSchema,
  repertoireId: uuidSchema,
  positionId: uuidSchema,
  trainable: z.boolean(),
  notes: z.string().optional(),
  tags: z.array(z.string()),
  priority: z.number().optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

const repertoireMoveSchema = z.object({
  id: uuidSchema,
  repertoireId: uuidSchema,
  moveEdgeId: uuidSchema,
  role: z.enum(['learner', 'opponent', 'alternative']),
  preferred: z.boolean(),
  order: z.number().optional(),
  explanation: z.string().optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

const positionMasterySchema = z.object({
  id: uuidSchema,
  positionId: uuidSchema,
  attempts: z.number().int().nonnegative(),
  correct: z.number().int().nonnegative(),
  incorrect: z.number().int().nonnegative(),
  averageDecisionTimeMs: z.number().nonnegative().nullable(),
  lastSeenAt: timestampSchema.nullable(),
  state: masteryStateSchema,
  score: z.number(),
  nextReviewAt: timestampSchema.nullable(),
  schedulingData: z.record(z.string(), z.unknown()).nullable(),
  updatedAt: timestampSchema,
});

const repertoireMoveMasterySchema = z.object({
  id: uuidSchema,
  repertoireMoveId: uuidSchema,
  attempts: z.number().int().nonnegative(),
  correct: z.number().int().nonnegative(),
  incorrect: z.number().int().nonnegative(),
  streak: z.number().int().nonnegative(),
  averageDecisionTimeMs: z.number().nonnegative().nullable(),
  lastAttemptedAt: timestampSchema.nullable(),
  state: masteryStateSchema,
  score: z.number(),
  nextReviewAt: timestampSchema.nullable(),
  schedulingData: z.record(z.string(), z.unknown()).nullable(),
  updatedAt: timestampSchema,
});

const trainingSessionSchema = z.object({
  id: uuidSchema,
  repertoireId: uuidSchema.optional(),
  mode: z.string().min(1),
  startedAt: timestampSchema,
  completedAt: timestampSchema.optional(),
});

const masterySnapshotSchema = z.object({
  positionState: masteryStateSchema,
  positionScore: z.number(),
  repertoireMoveState: masteryStateSchema.optional(),
  repertoireMoveScore: z.number().optional(),
});

const reviewAttemptSchema = z.object({
  targetRepertoireMoveId: uuidSchema,
  rating: z.enum(['again', 'hard', 'good', 'easy']),
  kind: z.enum(['scheduled', 'relearning']),
  schedulingApplied: z.boolean(),
  newCard: z.boolean(),
});

const trainingAttemptBaseShape = {
  id: uuidSchema,
  timestamp: timestampSchema,
  sessionId: uuidSchema.optional(),
  repertoireId: uuidSchema,
  positionId: uuidSchema,
  repertoireMoveId: uuidSchema.optional(),
  expectedMove: z.string(),
  actualMove: z.string(),
  correct: z.boolean(),
  decisionTimeMs: z.number().nonnegative(),
  hintCount: z.number().int().nonnegative(),
  hintUsed: z.boolean(),
  mode: z.string().min(1),
  masteryBefore: masterySnapshotSchema,
  masteryAfter: masterySnapshotSchema,
};

const trainingAttemptV1Schema = z.object(trainingAttemptBaseShape);
const trainingAttemptV2Schema = z.object(trainingAttemptBaseShape).extend({
  review: reviewAttemptSchema.optional(),
});

function dataSchema(
  learnerProfileSchema: typeof learnerProfileV1Schema | typeof learnerProfileV2Schema,
  trainingAttemptSchema: typeof trainingAttemptV1Schema | typeof trainingAttemptV2Schema,
) {
  return z.object({
    learnerProfiles: z.array(learnerProfileSchema),
    repertoires: z.array(repertoireSchema),
    positions: z.array(positionSchema),
    moveEdges: z.array(moveEdgeSchema),
    repertoirePositions: z.array(repertoirePositionSchema),
    repertoireMoves: z.array(repertoireMoveSchema),
    positionMastery: z.array(positionMasterySchema),
    repertoireMoveMastery: z.array(repertoireMoveMasterySchema),
    trainingSessions: z.array(trainingSessionSchema),
    trainingAttempts: z.array(trainingAttemptSchema),
  });
}

export const trainingBackupV1Schema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(BACKUP_VERSION_V1),
  exportedAt: timestampSchema,
  schemaVersion: z.number().int().positive(),
  data: dataSchema(learnerProfileV1Schema, trainingAttemptV1Schema),
});

export const trainingBackupV2Schema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(BACKUP_VERSION),
  exportedAt: timestampSchema,
  schemaVersion: z.number().int().positive(),
  data: dataSchema(learnerProfileV2Schema, trainingAttemptV2Schema),
});

function duplicateGuard(values: string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new ReferentialIntegrityError(`Backup contains duplicate ${label}.`);
  }
}

function requireReference<T>(
  map: Map<string, T>,
  id: string,
  label: string,
): T {
  const value = map.get(id);
  if (!value) {
    throw new ReferentialIntegrityError(`Backup references missing ${label}: ${id}`);
  }
  return value;
}

function parseStructure(input: unknown): TrainingBackup {
  if (
    typeof input === 'object'
    && input !== null
    && 'format' in input
    && (input as { format?: unknown }).format === BACKUP_FORMAT
    && 'version' in input
  ) {
    const version = (input as { version?: unknown }).version;
    if (version !== BACKUP_VERSION_V1 && version !== BACKUP_VERSION) {
      throw new UnsupportedBackupVersionError();
    }
  }

  const version = (
    typeof input === 'object' && input !== null && 'version' in input
  )
    ? (input as { version?: unknown }).version
    : undefined;
  const schema = version === BACKUP_VERSION
    ? trainingBackupV2Schema
    : trainingBackupV1Schema;
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new InvalidBackupError(
      parsed.error.issues.map((issue) => issue.message).join('; '),
    );
  }
  return parsed.data as TrainingBackupV1 | TrainingBackupV2;
}

export function parseAndValidateBackup(input: unknown): TrainingBackup {
  const backup = parseStructure(input);
  const data = backup.data;

  if (data.learnerProfiles.length !== 1) {
    throw new ReferentialIntegrityError(
      'Training backups must contain exactly one local learner profile.',
    );
  }

  const entityArrays = [
    data.learnerProfiles,
    data.repertoires,
    data.positions,
    data.moveEdges,
    data.repertoirePositions,
    data.repertoireMoves,
    data.positionMastery,
    data.repertoireMoveMastery,
    data.trainingSessions,
    data.trainingAttempts,
  ];
  duplicateGuard(
    entityArrays.flatMap((records) => records.map((record) => record.id)),
    'stable UUIDs',
  );
  duplicateGuard(data.positions.map((position) => position.positionKey), 'position keys');
  duplicateGuard(
    data.moveEdges.map((edge) => `${edge.fromPositionId}|${edge.moveKey}`),
    'canonical move edges',
  );
  duplicateGuard(
    data.repertoirePositions.map(
      (record) => `${record.repertoireId}|${record.positionId}`,
    ),
    'repertoire-position relationships',
  );
  duplicateGuard(
    data.repertoireMoves.map(
      (record) => `${record.repertoireId}|${record.moveEdgeId}`,
    ),
    'repertoire-move relationships',
  );
  duplicateGuard(
    data.positionMastery.map((record) => record.positionId),
    'position mastery contexts',
  );
  duplicateGuard(
    data.repertoireMoveMastery.map((record) => record.repertoireMoveId),
    'repertoire-move mastery contexts',
  );

  const learners = new Map(data.learnerProfiles.map((record) => [record.id, record]));
  const repertoires = new Map(data.repertoires.map((record) => [record.id, record]));
  const positions = new Map(data.positions.map((record) => [record.id, record]));
  const moveEdges = new Map(data.moveEdges.map((record) => [record.id, record]));
  const repertoireMoves = new Map(
    data.repertoireMoves.map((record) => [record.id, record]),
  );
  const sessions = new Map(
    data.trainingSessions.map((record) => [record.id, record]),
  );

  for (const repertoire of data.repertoires) {
    requireReference(learners, repertoire.learnerId, 'learner');
  }

  for (const position of data.positions) {
    try {
      if (positionKeyFromFen(position.fen) !== position.positionKey) {
        throw new InvalidBackupError(
          'Position FEN does not match its canonical position key.',
        );
      }
      const fenSide = position.fen.trim().split(/\s+/)[1];
      if (fenSide !== position.sideToMove) {
        throw new InvalidBackupError(
          'Position side-to-move does not match its FEN.',
        );
      }
    } catch (error) {
      if (error instanceof InvalidBackupError) throw error;
      throw new InvalidBackupError(
        error instanceof Error
          ? error.message
          : 'Backup contains an invalid position FEN.',
      );
    }
  }

  for (const edge of data.moveEdges) {
    const source = requireReference(
      positions,
      edge.fromPositionId,
      'source position',
    );
    const destination = requireReference(
      positions,
      edge.toPositionId,
      'destination position',
    );
    const derived = deriveTransition(source.fen, {
      from: edge.from,
      to: edge.to,
      promotion: edge.promotion,
    });
    if (
      derived.fromPositionKey !== source.positionKey
      || derived.moveKey !== edge.moveKey
      || derived.toPositionKey !== destination.positionKey
      || derived.san !== edge.san
    ) {
      throw new InvalidChessEdgeError(
        'Backup move edge does not match its source, move identity, SAN, or destination.',
      );
    }
  }

  for (const membership of data.repertoirePositions) {
    requireReference(repertoires, membership.repertoireId, 'repertoire');
    requireReference(positions, membership.positionId, 'position');
  }

  for (const repertoireMove of data.repertoireMoves) {
    requireReference(repertoires, repertoireMove.repertoireId, 'repertoire');
    requireReference(moveEdges, repertoireMove.moveEdgeId, 'move edge');
  }

  for (const mastery of data.positionMastery) {
    requireReference(positions, mastery.positionId, 'position mastery position');
  }

  for (const mastery of data.repertoireMoveMastery) {
    requireReference(
      repertoireMoves,
      mastery.repertoireMoveId,
      'repertoire move mastery context',
    );
    if (backup.version === BACKUP_VERSION) {
      if (mastery.schedulingData === null) {
        if (mastery.nextReviewAt !== null) {
          throw new InvalidBackupError(
            'Scheduled review due time requires FSRS scheduling data.',
          );
        }
      } else {
        let envelope;
        try {
          envelope = parseFsrsSchedulingEnvelope(mastery.schedulingData);
        } catch (error) {
          throw new InvalidBackupError(
            error instanceof Error
              ? error.message
              : 'Invalid FSRS scheduling data.',
          );
        }
        if (mastery.nextReviewAt !== envelope.card.due) {
          throw new InvalidBackupError(
            'Review due timestamp does not match FSRS scheduling data.',
          );
        }
      }
    }
  }

  for (const session of data.trainingSessions) {
    if (session.repertoireId) {
      requireReference(repertoires, session.repertoireId, 'session repertoire');
    }
  }

  for (const attempt of data.trainingAttempts) {
    requireReference(repertoires, attempt.repertoireId, 'attempt repertoire');
    requireReference(positions, attempt.positionId, 'attempt position');
    if (attempt.sessionId) {
      const session = requireReference(
        sessions,
        attempt.sessionId,
        'attempt session',
      );
      if (session.repertoireId && session.repertoireId !== attempt.repertoireId) {
        throw new ReferentialIntegrityError(
          'Attempt session belongs to a different repertoire.',
        );
      }
    }
    if (attempt.repertoireMoveId) {
      const repertoireMove = requireReference(
        repertoireMoves,
        attempt.repertoireMoveId,
        'attempt repertoire move',
      );
      if (repertoireMove.repertoireId !== attempt.repertoireId) {
        throw new ReferentialIntegrityError(
          'Attempt repertoire move belongs to a different repertoire.',
        );
      }
      const edge = requireReference(
        moveEdges,
        repertoireMove.moveEdgeId,
        'attempt move edge',
      );
      if (edge.fromPositionId !== attempt.positionId) {
        throw new ReferentialIntegrityError(
          'Attempt repertoire move does not originate from the attempted position.',
        );
      }
    }

    if (backup.version === BACKUP_VERSION && attempt.review) {
      const target = requireReference(
        repertoireMoves,
        attempt.review.targetRepertoireMoveId,
        'review target repertoire move',
      );
      if (target.repertoireId !== attempt.repertoireId) {
        throw new ReferentialIntegrityError(
          'Review target belongs to a different repertoire.',
        );
      }
      if (!target.preferred || target.role === 'opponent') {
        throw new ReferentialIntegrityError(
          'Review target must be the preferred learner move.',
        );
      }
      const targetEdge = requireReference(
        moveEdges,
        target.moveEdgeId,
        'review target move edge',
      );
      if (targetEdge.fromPositionId !== attempt.positionId) {
        throw new ReferentialIntegrityError(
          'Review target does not originate from the attempted position.',
        );
      }
      if (attempt.expectedMove !== targetEdge.moveKey) {
        throw new ReferentialIntegrityError(
          'Review expected move does not match the preferred target.',
        );
      }
      if (
        (attempt.review.kind === 'scheduled' && !attempt.review.schedulingApplied)
        || (attempt.review.kind === 'relearning' && attempt.review.schedulingApplied)
        || (attempt.review.newCard && !attempt.review.schedulingApplied)
      ) {
        throw new InvalidBackupError(
          'Review attempt metadata contains inconsistent scheduling flags.',
        );
      }
    }
  }

  return backup;
}
