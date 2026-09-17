import { InvalidChessEdgeError } from '../training/errors';
import { deriveTransition, type DerivedTransition } from '../training/graph';
import {
  nextPositionMastery,
  nextRepertoireMoveMastery,
} from '../training/mastery';
import type {
  CreateRepertoireImportInput,
  RecordAttemptInput,
  RepertoireTrainingSnapshot,
  RepertoireTransitionInput,
} from '../training/repositories';
import type {
  EntityId,
  LearnerProfile,
  MoveEdge,
  Position,
  PositionMastery,
  Repertoire,
  RepertoireMove,
  RepertoireMoveMastery,
  RepertoirePosition,
  TrainingAttempt,
  TrainingSession,
} from '../training/types';
import { createId } from '../training/types';
import { ChessTrainingDatabase } from './db';
import {
  StorageQuotaError,
  StorageUnavailableError,
  TransactionError,
} from './errors';

function isoNow(): string {
  return new Date().toISOString();
}

function sideToMoveFromFen(fen: string): 'w' | 'b' {
  const side = fen.trim().split(/\s+/)[1];
  if (side !== 'w' && side !== 'b') {
    throw new InvalidChessEdgeError('FEN does not contain a valid side to move.');
  }
  return side;
}

function translatePersistenceError(error: unknown): never {
  if (error instanceof InvalidChessEdgeError) throw error;
  if (
    error instanceof StorageQuotaError ||
    error instanceof StorageUnavailableError ||
    error instanceof TransactionError
  ) {
    throw error;
  }
  if (error instanceof Error && error.name === 'QuotaExceededError') {
    throw new StorageQuotaError(error.message);
  }
  if (error instanceof Error && error.name === 'MissingAPIError') {
    throw new StorageUnavailableError(error.message);
  }
  throw new TransactionError(
    error instanceof Error ? error.message : 'Training data transaction failed.',
  );
}

export class DexieTrainingRepository {
  constructor(readonly db: ChessTrainingDatabase) {}

  async ensureLocalLearner(displayName = 'Local learner'): Promise<LearnerProfile> {
    try {
      const existing = await this.db.learnerProfiles.toArray();
      if (existing.length > 1) {
        throw new TransactionError('Phase 2 supports exactly one local learner profile.');
      }
      if (existing[0]) return existing[0];

      const now = isoNow();
      const learner: LearnerProfile = {
        id: createId(),
        displayName,
        createdAt: now,
        updatedAt: now,
      };
      await this.db.learnerProfiles.add(learner);
      return learner;
    } catch (error) {
      translatePersistenceError(error);
    }
  }

  async saveRepertoire(repertoire: Repertoire): Promise<void> {
    try {
      const learner = await this.db.learnerProfiles.get(repertoire.learnerId);
      if (!learner) throw new TransactionError('Repertoire references a missing learner.');
      await this.db.repertoires.put(repertoire);
    } catch (error) {
      translatePersistenceError(error);
    }
  }

  async listRepertoires(learnerId: EntityId): Promise<Repertoire[]> {
    try {
      return await this.db.repertoires.where('learnerId').equals(learnerId).toArray();
    } catch (error) {
      translatePersistenceError(error);
    }
  }

  async getRepertoire(repertoireId: EntityId): Promise<Repertoire | undefined> {
    try {
      return await this.db.repertoires.get(repertoireId);
    } catch (error) {
      translatePersistenceError(error);
    }
  }

  async createRepertoireFromTransitions(input: CreateRepertoireImportInput): Promise<void> {
    const derived = input.transitions.map((transitionInput) => {
      if (transitionInput.repertoireId !== input.repertoire.id) {
        throw new TransactionError('Bulk transition belongs to a different repertoire.');
      }
      return {
        input: transitionInput,
        transition: deriveTransition(transitionInput.fromFen, transitionInput.move),
      };
    });

    try {
      await this.db.transaction(
        'rw',
        [
          this.db.learnerProfiles,
          this.db.repertoires,
          this.db.positions,
          this.db.moveEdges,
          this.db.repertoirePositions,
          this.db.repertoireMoves,
        ],
        async () => {
          const learner = await this.db.learnerProfiles.get(input.repertoire.learnerId);
          if (!learner) throw new TransactionError('Repertoire references a missing learner.');
          await this.db.repertoires.add(input.repertoire);
          for (const item of derived) {
            await this.persistDerivedTransition(item.input, item.transition);
          }
        },
      );
    } catch (error) {
      translatePersistenceError(error);
    }
  }

  async loadRepertoireTrainingSnapshot(
    repertoireId: EntityId,
  ): Promise<RepertoireTrainingSnapshot> {
    try {
      const repertoire = await this.db.repertoires.get(repertoireId);
      if (!repertoire) throw new TransactionError('Training repertoire was not found.');

      const [repertoirePositions, repertoireMoves, attempts] = await Promise.all([
        this.db.repertoirePositions.where('repertoireId').equals(repertoireId).toArray(),
        this.db.repertoireMoves.where('repertoireId').equals(repertoireId).toArray(),
        this.db.trainingAttempts.where('repertoireId').equals(repertoireId).toArray(),
      ]);
      const positionIds = [...new Set(repertoirePositions.map((item) => item.positionId))];
      const moveEdgeIds = [...new Set(repertoireMoves.map((item) => item.moveEdgeId))];
      const repertoireMoveIds = repertoireMoves.map((item) => item.id);

      const positions = positionIds.length
        ? (await this.db.positions.bulkGet(positionIds)).filter((item): item is Position => Boolean(item))
        : [];
      const moveEdges = moveEdgeIds.length
        ? (await this.db.moveEdges.bulkGet(moveEdgeIds)).filter((item): item is MoveEdge => Boolean(item))
        : [];
      const positionMastery = positionIds.length
        ? await this.db.positionMastery.where('positionId').anyOf(positionIds).toArray()
        : [];
      const repertoireMoveMastery = repertoireMoveIds.length
        ? await this.db.repertoireMoveMastery.where('repertoireMoveId').anyOf(repertoireMoveIds).toArray()
        : [];

      return {
        repertoire,
        positions,
        moveEdges,
        repertoirePositions,
        repertoireMoves,
        positionMastery,
        repertoireMoveMastery,
        attempts,
      };
    } catch (error) {
      translatePersistenceError(error);
    }
  }

  async completeSession(sessionId: EntityId, completedAt: string): Promise<void> {
    try {
      const session = await this.db.trainingSessions.get(sessionId);
      if (!session) throw new TransactionError('Training session was not found.');
      await this.db.trainingSessions.update(sessionId, { completedAt });
    } catch (error) {
      translatePersistenceError(error);
    }
  }

  async getPositionByKey(positionKey: string): Promise<Position | undefined> {
    try {
      return await this.db.positions.where('positionKey').equals(positionKey).first();
    } catch (error) {
      translatePersistenceError(error);
    }
  }

  async getPositionMastery(positionId: EntityId): Promise<PositionMastery | undefined> {
    try {
      return await this.db.positionMastery.where('positionId').equals(positionId).first();
    } catch (error) {
      translatePersistenceError(error);
    }
  }

  async getRepertoireMoveMastery(
    repertoireMoveId: EntityId,
  ): Promise<RepertoireMoveMastery | undefined> {
    try {
      return await this.db.repertoireMoveMastery
        .where('repertoireMoveId')
        .equals(repertoireMoveId)
        .first();
    } catch (error) {
      translatePersistenceError(error);
    }
  }

  async createSession(session: TrainingSession): Promise<void> {
    try {
      if (session.repertoireId && !(await this.db.repertoires.get(session.repertoireId))) {
        throw new TransactionError('Training session references a missing repertoire.');
      }
      await this.db.trainingSessions.add(session);
    } catch (error) {
      translatePersistenceError(error);
    }
  }

  async recordAttempt(input: RecordAttemptInput): Promise<TrainingAttempt> {
    const { attemptId, ...attemptInput } = input;
    if (!Number.isFinite(attemptInput.decisionTimeMs) || attemptInput.decisionTimeMs < 0) {
      throw new TransactionError('Decision time must be a non-negative finite number.');
    }
    if (!Number.isInteger(attemptInput.hintCount) || attemptInput.hintCount < 0) {
      throw new TransactionError('Hint count must be a non-negative integer.');
    }

    try {
      return await this.db.transaction(
        'rw',
        [
          this.db.trainingAttempts,
          this.db.positionMastery,
          this.db.repertoireMoveMastery,
          this.db.trainingSessions,
          this.db.repertoires,
          this.db.positions,
          this.db.repertoireMoves,
          this.db.moveEdges,
        ],
        async () => {
          if (attemptId) {
            const existing = await this.db.trainingAttempts.get(attemptId);
            if (existing) return existing;
          }

          const repertoire = await this.db.repertoires.get(attemptInput.repertoireId);
          if (!repertoire) {
            throw new TransactionError('Attempt references a missing repertoire.');
          }

          const position = await this.db.positions.get(attemptInput.positionId);
          if (!position) {
            throw new TransactionError('Attempt references a missing position.');
          }

          if (attemptInput.sessionId) {
            const session = await this.db.trainingSessions.get(attemptInput.sessionId);
            if (!session) {
              throw new TransactionError('Attempt references a missing training session.');
            }
            if (session.repertoireId && session.repertoireId !== attemptInput.repertoireId) {
              throw new TransactionError(
                'Training session belongs to a different repertoire.',
              );
            }
          }

          const currentPositionMastery = await this.db.positionMastery
            .where('positionId')
            .equals(attemptInput.positionId)
            .first();
          const currentRepertoireMoveMastery = attemptInput.repertoireMoveId
            ? await this.db.repertoireMoveMastery
                .where('repertoireMoveId')
                .equals(attemptInput.repertoireMoveId)
                .first()
            : undefined;

          const outcome = {
            correct: attemptInput.correct,
            decisionTimeMs: attemptInput.decisionTimeMs,
          };
          const nextPosition = nextPositionMastery(
            currentPositionMastery,
            attemptInput.positionId,
            outcome,
            attemptInput.timestamp,
          );
          const nextRepertoireMove = attemptInput.repertoireMoveId
            ? nextRepertoireMoveMastery(
                currentRepertoireMoveMastery,
                attemptInput.repertoireMoveId,
                outcome,
                attemptInput.timestamp,
              )
            : undefined;

          const masteryBefore = {
            positionState: currentPositionMastery?.state ?? ('new' as const),
            positionScore: currentPositionMastery?.score ?? 0,
            ...(attemptInput.repertoireMoveId
              ? {
                  repertoireMoveState:
                    currentRepertoireMoveMastery?.state ?? ('new' as const),
                  repertoireMoveScore: currentRepertoireMoveMastery?.score ?? 0,
                }
              : {}),
          };
          const masteryAfter = {
            positionState: nextPosition.state,
            positionScore: nextPosition.score,
            ...(nextRepertoireMove
              ? {
                  repertoireMoveState: nextRepertoireMove.state,
                  repertoireMoveScore: nextRepertoireMove.score,
                }
              : {}),
          };

          const attempt: TrainingAttempt = {
            ...attemptInput,
            id: attemptId ?? createId(),
            masteryBefore,
            masteryAfter,
          };

          await this.db.trainingAttempts.add(attempt);

          if (attemptInput.repertoireMoveId) {
            const repertoireMove = await this.db.repertoireMoves.get(attemptInput.repertoireMoveId);
            if (!repertoireMove) {
              throw new TransactionError('Attempt references a missing repertoire move.');
            }
            if (repertoireMove.repertoireId !== attemptInput.repertoireId) {
              throw new TransactionError('Repertoire move belongs to a different repertoire.');
            }
            const moveEdge = await this.db.moveEdges.get(repertoireMove.moveEdgeId);
            if (!moveEdge || moveEdge.fromPositionId !== attemptInput.positionId) {
              throw new TransactionError(
                'Repertoire move does not originate from the attempted position.',
              );
            }
          }

          await this.db.positionMastery.put(nextPosition);
          if (nextRepertoireMove) {
            await this.db.repertoireMoveMastery.put(nextRepertoireMove);
          }

          return attempt;
        },
      );
    } catch (error) {
      translatePersistenceError(error);
    }
  }

  async upsertRepertoireTransition(input: RepertoireTransitionInput): Promise<{
    fromPosition: Position;
    toPosition: Position;
    moveEdge: MoveEdge;
    repertoirePosition: RepertoirePosition;
    repertoireMove: RepertoireMove;
  }> {
    const transition = deriveTransition(input.fromFen, input.move);

    try {
      return await this.db.transaction(
        'rw',
        this.db.repertoires,
        this.db.positions,
        this.db.moveEdges,
        this.db.repertoirePositions,
        this.db.repertoireMoves,
        async () => {
          const repertoire = await this.db.repertoires.get(input.repertoireId);
          if (!repertoire) {
            throw new TransactionError('Transition references a missing repertoire.');
          }
          return this.persistDerivedTransition(input, transition);
        },
      );
    } catch (error) {
      translatePersistenceError(error);
    }
  }

  private async persistDerivedTransition(
    input: RepertoireTransitionInput,
    transition: DerivedTransition,
  ): Promise<{
    fromPosition: Position;
    toPosition: Position;
    moveEdge: MoveEdge;
    repertoirePosition: RepertoirePosition;
    repertoireMove: RepertoireMove;
  }> {
    const now = isoNow();
    const fromPosition = await this.getOrCreatePosition(
      transition.fromPositionKey,
      transition.fromFen,
      now,
    );
    const toPosition = await this.getOrCreatePosition(
      transition.toPositionKey,
      transition.toFen,
      now,
    );

    let moveEdge = await this.db.moveEdges
      .where('[fromPositionId+moveKey]')
      .equals([fromPosition.id, transition.moveKey])
      .first();

    if (moveEdge && moveEdge.toPositionId !== toPosition.id) {
      throw new InvalidChessEdgeError(
        'Existing canonical move edge points to a different destination position.',
      );
    }

    if (!moveEdge) {
      moveEdge = {
        id: createId(),
        fromPositionId: fromPosition.id,
        toPositionId: toPosition.id,
        moveKey: transition.moveKey,
        from: transition.from,
        to: transition.to,
        promotion: transition.promotion,
        san: transition.san,
        createdAt: now,
      };
      await this.db.moveEdges.add(moveEdge);
    }

    const repertoirePosition = await this.getOrCreateRepertoirePosition(
      input.repertoireId,
      fromPosition.id,
      input.trainable,
      now,
    );
    await this.getOrCreateRepertoirePosition(
      input.repertoireId,
      toPosition.id,
      false,
      now,
    );

    let repertoireMove = await this.db.repertoireMoves
      .where('[repertoireId+moveEdgeId]')
      .equals([input.repertoireId, moveEdge.id])
      .first();

    if (!repertoireMove) {
      repertoireMove = {
        id: createId(),
        repertoireId: input.repertoireId,
        moveEdgeId: moveEdge.id,
        role: input.role,
        preferred: input.preferred,
        order: input.order,
        explanation: input.explanation,
        createdAt: now,
        updatedAt: now,
      };
      await this.db.repertoireMoves.add(repertoireMove);
    } else {
      const updated: RepertoireMove = {
        ...repertoireMove,
        role: input.role,
        preferred: input.preferred,
        order: input.order ?? repertoireMove.order,
        explanation: repertoireMove.explanation ?? input.explanation,
        updatedAt: now,
      };
      const changed =
        updated.role !== repertoireMove.role ||
        updated.preferred !== repertoireMove.preferred ||
        updated.order !== repertoireMove.order ||
        updated.explanation !== repertoireMove.explanation;
      if (changed) {
        repertoireMove = updated;
        await this.db.repertoireMoves.put(repertoireMove);
      }
    }

    return {
      fromPosition,
      toPosition,
      moveEdge,
      repertoirePosition,
      repertoireMove,
    };
  }

  private async getOrCreatePosition(
    positionKey: string,
    fen: string,
    now: string,
  ): Promise<Position> {
    const existing = await this.db.positions.where('positionKey').equals(positionKey).first();
    if (existing) return existing;

    const position: Position = {
      id: createId(),
      positionKey,
      fen,
      sideToMove: sideToMoveFromFen(fen),
      createdAt: now,
      updatedAt: now,
    };
    await this.db.positions.add(position);
    return position;
  }

  private async getOrCreateRepertoirePosition(
    repertoireId: EntityId,
    positionId: EntityId,
    trainable: boolean,
    now: string,
  ): Promise<RepertoirePosition> {
    const existing = await this.db.repertoirePositions
      .where('[repertoireId+positionId]')
      .equals([repertoireId, positionId])
      .first();

    if (existing) {
      if (trainable && !existing.trainable) {
        const updated = { ...existing, trainable: true, updatedAt: now };
        await this.db.repertoirePositions.put(updated);
        return updated;
      }
      return existing;
    }

    const membership: RepertoirePosition = {
      id: createId(),
      repertoireId,
      positionId,
      trainable,
      tags: [],
      createdAt: now,
      updatedAt: now,
    };
    await this.db.repertoirePositions.add(membership);
    return membership;
  }
}
