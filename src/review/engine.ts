import { ChessGame } from '../core/game';
import { InvalidChessEdgeError } from '../training/errors';
import { deriveTransition } from '../training/graph';
import type {
  RecordScheduledAttemptInput,
  TrainingRepository,
} from '../training/repositories';
import {
  createId,
  type EntityId,
  type TrainingMoveInput,
} from '../training/types';
import {
  FsrsScheduler,
  parseFsrsSchedulingEnvelope,
  type ScheduledReviewResult,
} from './fsrsAdapter';
import { gradeReview } from './grader';
import type { ReviewCard, ReviewSessionPlan } from './queue';
import type { ReviewRating } from './types';

export type ReviewPromptPhase =
  | 'awaiting-move'
  | 'retry'
  | 'revealed'
  | 'resolved-not-persisted'
  | 'complete';

export type ReviewTrainingFeedback = {
  kind:
    | 'preferred'
    | 'alternative'
    | 'incorrect'
    | 'revealed'
    | 'storage-error';
  message: string;
  rating?: ReviewRating;
  preferredSan?: string;
  explanation?: string;
  decisionTimeMs?: number;
};

export type ReviewSessionSummary = {
  uniqueCardsReviewed: number;
  firstResponsePreferred: number;
  hardOutcomes: number;
  againOutcomes: number;
  relearningCompleted: number;
  averageDecisionTimeMs: number | null;
  remainingAfterBatch: number;
};

export type ReviewTrainingState = {
  repertoireId: EntityId;
  repertoireName: string;
  learnerSide: 'w' | 'b';
  fen: string;
  phase: ReviewPromptPhase;
  progress: {
    completed: number;
    total: number;
  };
  hintCount: number;
  hintText?: string;
  feedback?: ReviewTrainingFeedback;
  complete: boolean;
  relearning: boolean;
  moreAvailable: boolean;
  summary?: ReviewSessionSummary;
};

type ReviewRepository = Pick<
  TrainingRepository,
  'createSession' | 'completeSession' | 'recordScheduledAttempt'
>;

type RelearningEntry = {
  card: ReviewCard;
  failedAtMs: number;
  failurePromptOrdinal: number;
};

type PendingPersistence = {
  input: RecordScheduledAttemptInput;
  card: ReviewCard;
  kind: 'scheduled' | 'relearning';
  rating: ReviewRating;
  feedback: ReviewTrainingFeedback;
  decisionTimeMs: number;
  firstResponsePreferred: boolean;
};

export type ReviewTrainingEngineOptions = {
  plan: ReviewSessionPlan;
  repository: ReviewRepository;
  scheduler?: FsrsScheduler;
  nowMs?: () => number;
  nowDate?: () => Date;
};

const RELEARNING_DELAY_MS = 120_000;
const RELEARNING_INTERVENING_PROMPTS = 3;

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

export class ReviewTrainingEngine {
  private readonly plan: ReviewSessionPlan;
  private readonly repository: ReviewRepository;
  private readonly scheduler: FsrsScheduler;
  private readonly nowMs: () => number;
  private readonly nowDate: () => Date;
  private readonly sessionId = createId();

  private remainingCards: ReviewCard[];
  private currentCard!: ReviewCard;
  private currentKind: 'scheduled' | 'relearning' = 'scheduled';
  private phase: ReviewPromptPhase = 'awaiting-move';
  private hintCount = 0;
  private hintText?: string;
  private feedback?: ReviewTrainingFeedback;
  private complete = false;
  private sessionCompleted = false;
  private promptStartedAtMs = 0;
  private promptOrdinal = 0;
  private firstSubmittedMoveKey?: string;
  private firstDecisionTimeMs?: number;
  private wrongLegalMoves = 0;
  private pendingPersistence?: PendingPersistence;
  private persistenceInFlight = false;
  private relearningQueue: RelearningEntry[] = [];

  private uniqueCompleted = 0;
  private firstResponsePreferred = 0;
  private hardOutcomes = 0;
  private againOutcomes = 0;
  private relearningCompleted = 0;
  private totalDecisionTimeMs = 0;
  private persistedPrompts = 0;
  private summary?: ReviewSessionSummary;

  private constructor(options: ReviewTrainingEngineOptions) {
    if (options.plan.cards.length === 0) {
      throw new Error('Review Due requires at least one scheduled card.');
    }
    this.plan = options.plan;
    this.repository = options.repository;
    this.scheduler = options.scheduler ?? new FsrsScheduler();
    this.nowMs = options.nowMs ?? (() => performance.now());
    this.nowDate = options.nowDate ?? (() => new Date());
    this.remainingCards = [...options.plan.cards];
  }

  static async start(
    options: ReviewTrainingEngineOptions,
  ): Promise<ReviewTrainingEngine> {
    const engine = new ReviewTrainingEngine(options);
    await engine.initialize();
    return engine;
  }

  state(): ReviewTrainingState {
    const target = this.currentCard.target;
    const learnerSide = this.learnerSide(target.repertoire.side);
    return {
      repertoireId: target.repertoire.id,
      repertoireName: target.repertoire.name,
      learnerSide,
      fen: target.position.fen,
      phase: this.phase,
      progress: {
        completed: this.uniqueCompleted,
        total: this.plan.cards.length,
      },
      hintCount: this.hintCount,
      ...(this.hintText ? { hintText: this.hintText } : {}),
      ...(this.feedback ? { feedback: { ...this.feedback } } : {}),
      complete: this.complete,
      relearning: this.currentKind === 'relearning' && !this.complete,
      moreAvailable: this.plan.remainingAfterBatch > 0,
      ...(this.summary ? { summary: { ...this.summary } } : {}),
    };
  }

  requestHint(): ReviewTrainingState {
    if (
      this.persistenceInFlight
      || this.complete
      || this.phase === 'resolved-not-persisted'
      || !['awaiting-move', 'retry', 'revealed'].includes(this.phase)
    ) {
      return this.state();
    }

    this.hintCount += 1;
    const preferred = this.currentCard.target.preferred;
    if (this.hintCount === 1) {
      const game = new ChessGame(this.currentCard.target.position.fen);
      const piece = game.pieceAt(preferred.moveEdge.from);
      const label = pieceLabel(piece?.type);
      this.hintText = preferred.repertoireMove.explanation
        ? `${label} move. ${preferred.repertoireMove.explanation}`
        : `Consider a ${label} move.`;
    } else {
      this.hintText = `Preferred move: ${preferred.moveEdge.san}`;
    }
    return this.state();
  }

  async submitMove(move: TrainingMoveInput): Promise<ReviewTrainingState> {
    if (
      this.persistenceInFlight
      || this.complete
      || this.phase === 'resolved-not-persisted'
      || !['awaiting-move', 'retry', 'revealed'].includes(this.phase)
    ) {
      return this.state();
    }

    let derived;
    try {
      derived = deriveTransition(this.currentCard.target.position.fen, move);
    } catch (error) {
      if (error instanceof InvalidChessEdgeError) return this.state();
      throw error;
    }

    if (!this.firstSubmittedMoveKey) {
      this.firstSubmittedMoveKey = derived.moveKey;
      this.firstDecisionTimeMs = Math.max(
        0,
        this.nowMs() - this.promptStartedAtMs,
      );
    }

    const choices = [
      this.currentCard.target.preferred,
      ...this.currentCard.target.alternatives,
    ];
    const acceptedChoice = choices.find(
      (choice) => choice.moveEdge.moveKey === derived.moveKey,
    );
    const preferred = this.currentCard.target.preferred;

    if (
      !acceptedChoice
      || (
        this.wrongLegalMoves > 0
        && acceptedChoice.repertoireMove.id !== preferred.repertoireMove.id
      )
    ) {
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
          message: `Try ${preferred.moveEdge.san}.`,
          preferredSan: preferred.moveEdge.san,
          ...(preferred.repertoireMove.explanation
            ? { explanation: preferred.repertoireMove.explanation }
            : {}),
        };
      }
      return this.state();
    }

    const decisionTimeMs = this.firstDecisionTimeMs ?? 0;
    const firstResponseCorrect = this.wrongLegalMoves === 0;
    const preferredMoveRecalled =
      acceptedChoice.repertoireMove.id === preferred.repertoireMove.id;
    const acceptedAlternative =
      acceptedChoice.repertoireMove.id !== preferred.repertoireMove.id;
    const rating = gradeReview({
      firstResponseCorrect,
      preferredMoveRecalled,
      acceptedAlternative,
      hintUsed: this.hintCount > 0,
      decisionTimeMs,
      historicalAverageDecisionTimeMs:
        this.currentCard.target.mastery?.averageDecisionTimeMs ?? null,
      priorScheduledReviews:
        this.currentCard.target.priorScheduledReviews,
    });

    const feedback: ReviewTrainingFeedback = {
      kind: acceptedAlternative ? 'alternative' : 'preferred',
      message: acceptedAlternative
        ? 'Correct — accepted alternative.'
        : 'Correct.',
      rating,
      ...(acceptedAlternative
        ? { preferredSan: preferred.moveEdge.san }
        : {}),
      ...(acceptedChoice.repertoireMove.explanation
        ?? preferred.repertoireMove.explanation
        ? {
            explanation:
              acceptedChoice.repertoireMove.explanation
              ?? preferred.repertoireMove.explanation,
          }
        : {}),
      decisionTimeMs,
    };

    const schedulingApplied = this.currentKind === 'scheduled';
    let scheduledReview: ScheduledReviewResult | null = null;
    if (schedulingApplied) {
      const stored = this.currentCard.target.mastery?.schedulingData ?? null;
      const current = stored
        ? parseFsrsSchedulingEnvelope(stored)
        : null;
      scheduledReview = this.scheduler.schedule(
        current,
        rating,
        this.nowDate(),
      );
    }

    const attemptInput: RecordScheduledAttemptInput = {
      attemptId: createId(),
      timestamp: this.nowDate().toISOString(),
      sessionId: this.sessionId,
      repertoireId: this.currentCard.target.repertoire.id,
      positionId: this.currentCard.target.position.id,
      repertoireMoveId: acceptedChoice.repertoireMove.id,
      expectedMove: preferred.moveEdge.moveKey,
      actualMove:
        this.firstSubmittedMoveKey ?? acceptedChoice.moveEdge.moveKey,
      correct: firstResponseCorrect,
      decisionTimeMs,
      hintCount: this.hintCount,
      hintUsed: this.hintCount > 0,
      mode: 'opening:review-due',
      review: {
        targetRepertoireMoveId: preferred.repertoireMove.id,
        rating,
        kind: this.currentKind,
        schedulingApplied,
        newCard: schedulingApplied && this.currentCard.newCard,
      },
      expectedTargetUpdatedAt:
        this.currentCard.target.mastery?.updatedAt ?? null,
      scheduledReview,
    };

    this.pendingPersistence = {
      input: attemptInput,
      card: this.currentCard,
      kind: this.currentKind,
      rating,
      feedback,
      decisionTimeMs,
      firstResponsePreferred:
        firstResponseCorrect
        && preferredMoveRecalled
        && !this.hintCount,
    };
    this.feedback = feedback;
    this.persistenceInFlight = true;
    return this.persistPending();
  }

  async retryPersistence(): Promise<ReviewTrainingState> {
    if (
      this.persistenceInFlight
      || this.phase !== 'resolved-not-persisted'
      || !this.pendingPersistence
    ) {
      return this.state();
    }
    this.persistenceInFlight = true;
    return this.persistPending();
  }

  async stop(): Promise<void> {
    if (this.sessionCompleted) return;
    await this.repository.completeSession(
      this.sessionId,
      this.nowDate().toISOString(),
    );
    this.sessionCompleted = true;
    this.complete = true;
    this.phase = 'complete';
    this.finalizeSummary();
  }

  private async initialize(): Promise<void> {
    await this.repository.createSession({
      id: this.sessionId,
      mode: 'opening:review-due',
      startedAt: this.nowDate().toISOString(),
    });
    const first = this.remainingCards.shift();
    if (!first) throw new Error('Review Due session plan is empty.');
    this.setPrompt(first, 'scheduled', false);
  }

  private setPrompt(
    card: ReviewCard,
    kind: 'scheduled' | 'relearning',
    preserveFeedback: boolean,
  ): void {
    this.currentCard = card;
    this.currentKind = kind;
    this.phase = 'awaiting-move';
    this.complete = false;
    this.hintCount = 0;
    this.hintText = undefined;
    if (!preserveFeedback) this.feedback = undefined;
    this.promptStartedAtMs = this.nowMs();
    this.promptOrdinal += 1;
    this.firstSubmittedMoveKey = undefined;
    this.firstDecisionTimeMs = undefined;
    this.wrongLegalMoves = 0;
    this.pendingPersistence = undefined;
  }

  private async persistPending(): Promise<ReviewTrainingState> {
    const pending = this.pendingPersistence;
    if (!pending) {
      this.persistenceInFlight = false;
      return this.state();
    }

    try {
      try {
        await this.repository.recordScheduledAttempt(pending.input);
      } catch {
        this.phase = 'resolved-not-persisted';
        this.feedback = {
          ...pending.feedback,
          kind: 'storage-error',
          message: 'Could not save this review. Retry to continue.',
        };
        return this.state();
      }

      this.pendingPersistence = undefined;
      this.totalDecisionTimeMs += pending.decisionTimeMs;
      this.persistedPrompts += 1;

      if (pending.kind === 'scheduled') {
        this.uniqueCompleted += 1;
        if (pending.firstResponsePreferred) {
          this.firstResponsePreferred += 1;
        }
        if (pending.rating === 'hard') this.hardOutcomes += 1;
        if (pending.rating === 'again') {
          this.againOutcomes += 1;
          this.relearningQueue.push({
            card: pending.card,
            failedAtMs: this.nowMs(),
            failurePromptOrdinal: this.promptOrdinal,
          });
        }
      } else {
        this.relearningCompleted += 1;
      }

      this.feedback = pending.feedback;
      await this.advanceAfterPersistence();
      return this.state();
    } finally {
      this.persistenceInFlight = false;
    }
  }

  private async advanceAfterPersistence(): Promise<void> {
    const eligibleIndex = this.relearningQueue.findIndex(
      (entry) =>
        this.promptOrdinal - entry.failurePromptOrdinal
          >= RELEARNING_INTERVENING_PROMPTS
        && this.nowMs() - entry.failedAtMs >= RELEARNING_DELAY_MS,
    );

    if (eligibleIndex >= 0) {
      const [entry] = this.relearningQueue.splice(eligibleIndex, 1);
      this.setPrompt(entry.card, 'relearning', true);
      return;
    }

    const next = this.remainingCards.shift();
    if (next) {
      this.setPrompt(next, 'scheduled', true);
      return;
    }

    await this.finishSession();
  }

  private async finishSession(): Promise<void> {
    if (!this.sessionCompleted) {
      await this.repository.completeSession(
        this.sessionId,
        this.nowDate().toISOString(),
      );
      this.sessionCompleted = true;
    }
    this.complete = true;
    this.phase = 'complete';
    this.finalizeSummary();
  }

  private finalizeSummary(): void {
    this.summary = {
      uniqueCardsReviewed: this.uniqueCompleted,
      firstResponsePreferred: this.firstResponsePreferred,
      hardOutcomes: this.hardOutcomes,
      againOutcomes: this.againOutcomes,
      relearningCompleted: this.relearningCompleted,
      averageDecisionTimeMs:
        this.persistedPrompts > 0
          ? this.totalDecisionTimeMs / this.persistedPrompts
          : null,
      remainingAfterBatch: this.plan.remainingAfterBatch,
    };
  }

  private learnerSide(side: string): 'w' | 'b' {
    if (side === 'white') return 'w';
    if (side === 'black') return 'b';
    throw new Error('Review Due requires a White or Black repertoire.');
  }
}
