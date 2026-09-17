import { InvalidChessEdgeError } from '../training/errors';
import { deriveTransition } from '../training/graph';
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
  TrainingSession,
} from '../training/types';
import { createId } from '../training/types';
import type { RepertoireTransitionInput } from '../training/repositories';
import { StorageQuotaError, StorageUnavailableError, TransactionError } from './errors';
import { ChessTrainingDatabase } from './db';

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
  if (error instanceof StorageQuotaError || error instanceof StorageUnavailableError || error instanceof TransactionError) {
    throw error;
  }
  if (error instanceof Error && error.name === 'QuotaExceededError') {
    throw new StorageQuotaError(error.message);
  }
  if (error instanceof Error && error.name === 'MissingAPIError') {
    throw new StorageUnavailableError(error.message);
  }
  throw new TransactionError(error instanceof Error ? error.message : 'Training data transaction failed.');
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
              createdAt: now,
              updatedAt: now,
            };
            await this.db.repertoireMoves.add(repertoireMove);
          } else if (
            repertoireMove.role !== input.role ||
            repertoireMove.preferred !== input.preferred
          ) {
            repertoireMove = {
              ...repertoireMove,
              role: input.role,
              preferred: input.preferred,
              updatedAt: now,
            };
            await this.db.repertoireMoves.put(repertoireMove);
          }

          return {
            fromPosition,
            toPosition,
            moveEdge,
            repertoirePosition,
            repertoireMove,
          };
        },
      );
    } catch (error) {
      translatePersistenceError(error);
    }
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
