import { ChessGame } from '../../core/game';
import { InvalidChessEdgeError } from '../../training/errors';
import { deriveTransition } from '../../training/graph';
import type {
  RecordAttemptInput,
  RepertoireTrainingSnapshot,
  TrainingRepository,
} from '../../training/repositories';
import {
  createId,
  type EntityId,
  type MoveEdge,
  type Position,
  type TrainingMoveInput,
} from '../../training/types';
import {
  chooseWeighted,
  opponentResponseWeight,
  quickRecallWeight,
} from './selectors';
import { getSpeedFeedback } from './speed';
import type {
  OpeningMoveChoice,
  OpeningTrainingFeedback,
  OpeningTrainingMode,
  OpeningTrainingState,
  PromptPhase,
} from './types';

const DEFAULT_TARGET_DECISION_MS = 5_000;
const DEFAULT_QUICK_RECALL_SIZE = 10;

type PendingPersistence = {
  input: RecordAttemptInput;
  acceptedChoice: OpeningMoveChoice;
  feedback: OpeningTrainingFeedback;
};

type OpeningTrainingEngineOptions = {
  snapshot: RepertoireTrainingSnapshot;
  repository: TrainingRepository;
  mode: OpeningTrainingMode;
  now?: () => number;
  random?: () => number;
  targetDecisionMs?: number;
  quickRecallSize?: number;
};

function pieceLabel(type: string | undefined): string {
  switch (type) {
    case 'p':
      return 'Pawn';
    case 'n':
      return 'Knight';
    case 'b':
      return 'Bishop';
    case 'r':
      return 'Rook';
    case 'q':
      return 'Queen';
    case 'k':
      return 'King';
    default:
      return 'Piece';
  }
}

export class OpeningTrainingEngine {
  private readonly snapshot: RepertoireTrainingSnapshot;
  private readonly repository: TrainingRepository;
  private readonly mode: OpeningTrainingMode;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly targetDecisionMs: number;
  private readonly quickRecallSize: number;
  private readonly learnerSide: 'w' | 'b';
  private readonly sessionId = createId();

  private readonly positionById = new Map<EntityId, Position>();
  private readonly edgeById = new Map<EntityId, MoveEdge>();
  private readonly outgoingByPosition = new Map<EntityId, OpeningMoveChoice[]>();
  private readonly positionMasteryAttempts = new Map<EntityId, number>();
  private readonly opponentExposure = new Map<EntityId, number>();
  private readonly attemptsByPosition = new Map<EntityId, RepertoireTrainingSnapshot['attempts']>();

  private currentPosition!: Position;
  private currentChoices: OpeningMoveChoice[] = [];
  private preferredChoice!: OpeningMoveChoice;
  private phase: PromptPhase = 'awaiting-move';
  private progress: { completed: number; total: number | null };
  private hintCount = 0;
  private hintText?: string;
  private feedback?: OpeningTrainingFeedback;
  private complete = false;
  private sessionCompleted = false;
  private promptStartedAtMs = 0;
  private firstSubmittedMoveKey?: string;
  private firstDecisionTimeMs?: number;
  private wrongLegalMoves = 0;
  private pendingPersistence?: PendingPersistence;
  private remainingQuickRecallPositionIds: EntityId[] = [];

  private constructor(options: OpeningTrainingEngineOptions) {
    this.snapshot = options.snapshot;
    this.repository = options.repository;
    this.mode = options.mode;
    this.now = options.now ?? (() => performance.now());
    this.random = options.random ?? Math.random;
    this.targetDecisionMs = options.targetDecisionMs ?? DEFAULT_TARGET_DECISION_MS;
    this.quickRecallSize = options.quickRecallSize ?? DEFAULT_QUICK_RECALL_SIZE;

    if (!Number.isFinite(this.targetDecisionMs) || this.targetDecisionMs <= 0) {
      throw new Error('Opening training decision target must be positive.');
    }
    if (!Number.isInteger(this.quickRecallSize) || this.quickRecallSize <= 0) {
      throw new Error('Quick Recall size must be a positive integer.');
    }
    if (this.snapshot.repertoire.side === 'white') this.learnerSide = 'w';
    else if (this.snapshot.repertoire.side === 'black') this.learnerSide = 'b';
    else throw new Error('Opening training requires a White or Black repertoire.');

    this.progress = {
      completed: 0,
      total: this.mode === 'quick-recall' ? 0 : null,
    };
    this.buildGraphIndex();
  }

  static async start(options: OpeningTrainingEngineOptions): Promise<OpeningTrainingEngine> {
    const engine = new OpeningTrainingEngine(options);
    await engine.initialize();
    return engine;
  }

  state(): OpeningTrainingState {
    return {
      mode: this.mode,
      repertoireId: this.snapshot.repertoire.id,
      repertoireName: this.snapshot.repertoire.name,
      learnerSide: this.learnerSide,
      fen: this.currentPosition.fen,
      phase: this.phase,
      progress: { ...this.progress },
      hintCount: this.hintCount,
      ...(this.hintText ? { hintText: this.hintText } : {}),
      ...(this.feedback ? { feedback: { ...this.feedback } } : {}),
      complete: this.complete,
    };
  }

  requestHint(): OpeningTrainingState {
    if (this.complete || this.phase === 'resolved-not-persisted') return this.state();
    if (!['awaiting-move', 'retry', 'revealed'].includes(this.phase)) return this.state();

    this.hintCount += 1;
    if (this.hintCount === 1) {
      const game = new ChessGame(this.currentPosition.fen);
      const piece = game.pieceAt(this.preferredChoice.moveEdge.from);
      const label = pieceLabel(piece?.type);
      this.hintText = this.preferredChoice.repertoireMove.explanation
        ? `${label} move. ${this.preferredChoice.repertoireMove.explanation}`
        : `Consider a ${label} move.`;
    } else {
      this.hintText = `Preferred move: ${this.preferredChoice.moveEdge.san}`;
    }
    return this.state();
  }

  async submitMove(move: TrainingMoveInput): Promise<OpeningTrainingState> {
    if (this.complete || this.phase === 'resolved-not-persisted') return this.state();
    if (!['awaiting-move', 'retry', 'revealed'].includes(this.phase)) return this.state();

    let derived;
    try {
      derived = deriveTransition(this.currentPosition.fen, move);
    } catch (error) {
      if (error instanceof InvalidChessEdgeError) return this.state();
      throw error;
    }

    if (!this.firstSubmittedMoveKey) {
      this.firstSubmittedMoveKey = derived.moveKey;
      this.firstDecisionTimeMs = Math.max(0, this.now() - this.promptStartedAtMs);
    }

    const acceptedChoice = this.currentChoices.find(
      (choice) => choice.moveEdge.moveKey === derived.moveKey,
    );

    if (!acceptedChoice) {
      this.wrongLegalMoves += 1;
      if (this.wrongLegalMoves === 1) {
        this.phase = 'retry';
        this.feedback = {
          kind: 'incorrect',
          message: 'Not quite. Look again.',
        };
      } else {
        this.phase = 'revealed';
        this.feedback = {
          kind: 'revealed',
          message: `Try ${this.preferredChoice.moveEdge.san}.`,
          preferredSan: this.preferredChoice.moveEdge.san,
          ...(this.preferredChoice.repertoireMove.explanation
            ? { explanation: this.preferredChoice.repertoireMove.explanation }
            : {}),
        };
      }
      return this.state();
    }

    const decisionTimeMs = this.firstDecisionTimeMs ?? 0;
    const feedback: OpeningTrainingFeedback = {
      kind: acceptedChoice.repertoireMove.preferred ? 'preferred' : 'alternative',
      message: acceptedChoice.repertoireMove.preferred ? 'Correct.' : 'Correct — accepted alternative.',
      ...(acceptedChoice.repertoireMove.preferred
        ? {}
        : { preferredSan: this.preferredChoice.moveEdge.san }),
      ...(acceptedChoice.repertoireMove.explanation ?? this.preferredChoice.repertoireMove.explanation
        ? {
            explanation:
              acceptedChoice.repertoireMove.explanation
              ?? this.preferredChoice.repertoireMove.explanation,
          }
        : {}),
      decisionTimeMs,
      speed: getSpeedFeedback(decisionTimeMs, this.targetDecisionMs),
    };
    this.feedback = feedback;

    const firstResponseWasAccepted = this.wrongLegalMoves === 0
      && this.firstSubmittedMoveKey === acceptedChoice.moveEdge.moveKey;
    const attemptInput: RecordAttemptInput = {
      attemptId: createId(),
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      repertoireId: this.snapshot.repertoire.id,
      positionId: this.currentPosition.id,
      repertoireMoveId: acceptedChoice.repertoireMove.id,
      expectedMove: this.preferredChoice.moveEdge.moveKey,
      actualMove: this.firstSubmittedMoveKey ?? acceptedChoice.moveEdge.moveKey,
      correct: firstResponseWasAccepted,
      decisionTimeMs,
      hintCount: this.hintCount,
      hintUsed: this.hintCount > 0,
      mode: `opening:${this.mode}`,
    };

    this.pendingPersistence = {
      input: attemptInput,
      acceptedChoice,
      feedback,
    };
    return this.persistPending();
  }

  async retryPersistence(): Promise<OpeningTrainingState> {
    if (this.phase !== 'resolved-not-persisted' || !this.pendingPersistence) {
      return this.state();
    }
    return this.persistPending();
  }

  async stop(): Promise<void> {
    if (this.sessionCompleted) return;
    await this.repository.completeSession(this.sessionId, new Date().toISOString());
    this.sessionCompleted = true;
    this.complete = true;
    this.phase = 'complete';
  }

  private buildGraphIndex(): void {
    for (const position of this.snapshot.positions) {
      this.positionById.set(position.id, position);
    }
    this.edgeById.clear();
    for (const edge of this.snapshot.moveEdges) this.edgeById.set(edge.id, edge);
    for (const mastery of this.snapshot.positionMastery) {
      this.positionMasteryAttempts.set(mastery.positionId, mastery.attempts);
    }
    for (const attempt of this.snapshot.attempts) {
      const list = this.attemptsByPosition.get(attempt.positionId) ?? [];
      list.push(attempt);
      this.attemptsByPosition.set(attempt.positionId, list);
    }

    for (const repertoireMove of this.snapshot.repertoireMoves) {
      const edge = this.edgeById.get(repertoireMove.moveEdgeId);
      if (!edge) throw new Error('Opening repertoire references a missing move edge.');
      const fromPosition = this.positionById.get(edge.fromPositionId);
      const toPosition = this.positionById.get(edge.toPositionId);
      if (!fromPosition || !toPosition) {
        throw new Error('Opening repertoire move edge references a missing position.');
      }
      const list = this.outgoingByPosition.get(fromPosition.id) ?? [];
      list.push({ repertoireMove, moveEdge: edge, toPosition });
      this.outgoingByPosition.set(fromPosition.id, list);
    }

    for (const choices of this.outgoingByPosition.values()) {
      choices.sort((a, b) => {
        const aOrder = a.repertoireMove.order ?? Number.MAX_SAFE_INTEGER;
        const bOrder = b.repertoireMove.order ?? Number.MAX_SAFE_INTEGER;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return a.moveEdge.moveKey.localeCompare(b.moveEdge.moveKey);
      });
    }

    for (const membership of this.snapshot.repertoirePositions.filter((item) => item.trainable)) {
      const position = this.positionById.get(membership.positionId);
      if (!position) throw new Error('Trainable repertoire position is missing.');
      if (position.sideToMove !== this.learnerSide) {
        throw new Error('Trainable repertoire position is on the wrong side to move.');
      }
      this.learnerChoices(position);
    }
  }

  private async initialize(): Promise<void> {
    await this.repository.createSession({
      id: this.sessionId,
      repertoireId: this.snapshot.repertoire.id,
      mode: `opening:${this.mode}`,
      startedAt: new Date().toISOString(),
    });

    if (this.mode === 'practice-line') {
      this.progress = { completed: 0, total: null };
      const root = this.findPracticeRoot();
      await this.advancePracticeFrom(root, false);
      return;
    }

    const eligible = this.snapshot.repertoirePositions
      .filter((item) => item.trainable)
      .map((item) => item.positionId);
    if (eligible.length === 0) {
      throw new Error('Quick Recall requires at least one trainable learner position.');
    }
    this.remainingQuickRecallPositionIds = [...eligible];
    this.progress = {
      completed: 0,
      total: Math.min(this.quickRecallSize, eligible.length),
    };
    this.selectNextQuickRecall(false);
  }

  private findPracticeRoot(): Position {
    const sourceIds = new Set<EntityId>();
    const destinationIds = new Set<EntityId>();
    for (const repertoireMove of this.snapshot.repertoireMoves) {
      const edge = this.edgeById.get(repertoireMove.moveEdgeId);
      if (!edge) continue;
      sourceIds.add(edge.fromPositionId);
      destinationIds.add(edge.toPositionId);
    }
    const rootIds = [...sourceIds].filter((id) => !destinationIds.has(id));
    if (rootIds.length !== 1) {
      throw new Error(`Practice Line requires exactly one repertoire root; found ${rootIds.length}.`);
    }
    const root = this.positionById.get(rootIds[0]);
    if (!root) throw new Error('Practice Line root position is missing.');
    return root;
  }

  private learnerChoices(position: Position): OpeningMoveChoice[] {
    const choices = (this.outgoingByPosition.get(position.id) ?? []).filter(
      (choice) => choice.repertoireMove.role !== 'opponent',
    );
    if (choices.length === 0) {
      throw new Error('Trainable learner position has no repertoire move.');
    }
    const preferred = choices.filter((choice) => choice.repertoireMove.preferred);
    if (preferred.length !== 1) {
      throw new Error(
        `Trainable learner position requires exactly one preferred move; found ${preferred.length}.`,
      );
    }
    return choices;
  }

  private setPrompt(position: Position, preserveFeedback: boolean): void {
    const choices = this.learnerChoices(position);
    this.currentPosition = position;
    this.currentChoices = choices;
    this.preferredChoice = choices.find((choice) => choice.repertoireMove.preferred)!;
    this.phase = 'awaiting-move';
    this.complete = false;
    this.hintCount = 0;
    this.hintText = undefined;
    if (!preserveFeedback) this.feedback = undefined;
    this.promptStartedAtMs = this.now();
    this.firstSubmittedMoveKey = undefined;
    this.firstDecisionTimeMs = undefined;
    this.wrongLegalMoves = 0;
    this.pendingPersistence = undefined;
  }

  private async persistPending(): Promise<OpeningTrainingState> {
    const pending = this.pendingPersistence;
    if (!pending) return this.state();

    try {
      await this.repository.recordAttempt(pending.input);
    } catch {
      this.phase = 'resolved-not-persisted';
      this.feedback = pending.feedback;
      return this.state();
    }

    this.pendingPersistence = undefined;
    this.progress = {
      ...this.progress,
      completed: this.progress.completed + 1,
    };

    if (this.mode === 'quick-recall') {
      if (
        this.progress.total !== null
        && this.progress.completed >= this.progress.total
      ) {
        this.currentPosition = pending.acceptedChoice.toPosition;
        this.feedback = pending.feedback;
        await this.finishSession();
      } else {
        this.feedback = pending.feedback;
        this.selectNextQuickRecall(true);
      }
      return this.state();
    }

    this.feedback = pending.feedback;
    await this.advancePracticeFrom(pending.acceptedChoice.toPosition, true);
    return this.state();
  }

  private selectNextQuickRecall(preserveFeedback: boolean): void {
    const total = this.progress.total ?? 0;
    if (this.progress.completed >= total || this.remainingQuickRecallPositionIds.length === 0) {
      throw new Error('Quick Recall ran out of eligible positions before reaching its target.');
    }

    const weighted = this.remainingQuickRecallPositionIds.map((positionId) => {
      const attempts = this.attemptsByPosition.get(positionId) ?? [];
      return {
        value: positionId,
        weight: quickRecallWeight({
          attempts: attempts.length,
          incorrect: attempts.filter((attempt) => !attempt.correct).length,
          hintedAttempts: attempts.filter((attempt) => attempt.hintUsed).length,
          slowAttempts: attempts.filter(
            (attempt) => attempt.decisionTimeMs > this.targetDecisionMs,
          ).length,
        }),
      };
    });
    const selectedId = chooseWeighted(weighted, this.random);
    this.remainingQuickRecallPositionIds = this.remainingQuickRecallPositionIds.filter(
      (id) => id !== selectedId,
    );
    const position = this.positionById.get(selectedId);
    if (!position) throw new Error('Quick Recall selected a missing position.');
    this.setPrompt(position, preserveFeedback);
  }

  private async advancePracticeFrom(position: Position, preserveFeedback: boolean): Promise<void> {
    let current = position;

    while (true) {
      const outgoing = this.outgoingByPosition.get(current.id) ?? [];
      if (outgoing.length === 0) {
        this.currentPosition = current;
        await this.finishSession();
        return;
      }

      if (current.sideToMove === this.learnerSide) {
        this.setPrompt(current, preserveFeedback);
        return;
      }

      const opponentChoices = outgoing.filter(
        (choice) => choice.repertoireMove.role === 'opponent',
      );
      if (opponentChoices.length === 0) {
        throw new Error('Opponent turn has no repertoire continuation.');
      }

      const choice = chooseWeighted(
        opponentChoices.map((candidate) => ({
          value: candidate,
          weight: opponentResponseWeight({
            destinationAttempts:
              this.positionMasteryAttempts.get(candidate.toPosition.id) ?? 0,
            sessionExposure:
              this.opponentExposure.get(candidate.repertoireMove.id) ?? 0,
          }),
        })),
        this.random,
      );
      this.applyCanonicalChoice(current, choice);
      this.opponentExposure.set(
        choice.repertoireMove.id,
        (this.opponentExposure.get(choice.repertoireMove.id) ?? 0) + 1,
      );
      current = choice.toPosition;
      this.currentPosition = current;
    }
  }

  private applyCanonicalChoice(fromPosition: Position, choice: OpeningMoveChoice): void {
    if (choice.moveEdge.fromPositionId !== fromPosition.id) {
      throw new Error('Repertoire move does not originate from the current position.');
    }
    const game = new ChessGame(fromPosition.fen);
    const applied = game.move(
      choice.moveEdge.from,
      choice.moveEdge.to,
      choice.moveEdge.promotion,
    );
    if (!applied) throw new Error('Stored repertoire move is illegal from the current position.');
    if (game.snapshot().positionKey !== choice.toPosition.positionKey) {
      throw new Error('Stored repertoire move does not reach its canonical destination.');
    }
  }

  private async finishSession(): Promise<void> {
    if (!this.sessionCompleted) {
      await this.repository.completeSession(this.sessionId, new Date().toISOString());
      this.sessionCompleted = true;
    }
    this.complete = true;
    this.phase = 'complete';
  }
}

export type { OpeningTrainingEngineOptions };
