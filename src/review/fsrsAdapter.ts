import {
  createEmptyCard,
  fsrs,
  Rating,
  State,
  type Card,
  type Grade,
} from 'ts-fsrs';
import type { ReviewRating } from './types';

export type FsrsCardState = 'new' | 'learning' | 'review' | 'relearning';

export type FsrsSchedulingEnvelopeV1 = {
  kind: 'fsrs';
  schedulingSchemaVersion: 1;
  library: {
    name: 'ts-fsrs';
    major: 5;
  };
  card: {
    due: string;
    stability: number;
    difficulty: number;
    elapsedDays: number;
    scheduledDays: number;
    reps: number;
    lapses: number;
    learningSteps: number;
    state: FsrsCardState;
    lastReviewAt: string | null;
  };
};

export type ScheduledReviewResult = {
  schedulingData: FsrsSchedulingEnvelopeV1;
  nextReviewAt: string;
};

const stateToStorage: Record<number, FsrsCardState> = {
  [State.New]: 'new',
  [State.Learning]: 'learning',
  [State.Review]: 'review',
  [State.Relearning]: 'relearning',
};

const storageToState: Record<FsrsCardState, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};

const ratingToFsrs: Record<ReviewRating, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireFiniteNonNegative(
  record: Record<string, unknown>,
  key: string,
  integer = false,
): number {
  const value = record[key];
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || value < 0
    || (integer && !Number.isInteger(value))
  ) {
    throw new Error(`Invalid FSRS ${key} number.`);
  }
  return value;
}

function requireIsoTimestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new Error(`Invalid FSRS ${label} timestamp.`);
  }
  return value;
}

export function parseFsrsSchedulingEnvelope(
  input: unknown,
): FsrsSchedulingEnvelopeV1 {
  if (!isRecord(input) || input.kind !== 'fsrs') {
    throw new Error('Invalid FSRS scheduling envelope kind.');
  }
  if (input.schedulingSchemaVersion !== 1) {
    throw new Error('Unsupported FSRS scheduling schema version.');
  }

  const library = input.library;
  if (
    !isRecord(library)
    || library.name !== 'ts-fsrs'
    || library.major !== 5
  ) {
    throw new Error('Unsupported FSRS library major version.');
  }

  const card = input.card;
  if (!isRecord(card)) {
    throw new Error('Invalid FSRS card data.');
  }

  const state = card.state;
  if (
    state !== 'new'
    && state !== 'learning'
    && state !== 'review'
    && state !== 'relearning'
  ) {
    throw new Error('Invalid FSRS card state.');
  }

  const due = requireIsoTimestamp(card.due, 'due');
  const lastReviewAt = card.lastReviewAt === null
    ? null
    : requireIsoTimestamp(card.lastReviewAt, 'last review');

  return {
    kind: 'fsrs',
    schedulingSchemaVersion: 1,
    library: {
      name: 'ts-fsrs',
      major: 5,
    },
    card: {
      due,
      stability: requireFiniteNonNegative(card, 'stability'),
      difficulty: requireFiniteNonNegative(card, 'difficulty'),
      elapsedDays: requireFiniteNonNegative(card, 'elapsedDays'),
      scheduledDays: requireFiniteNonNegative(card, 'scheduledDays'),
      reps: requireFiniteNonNegative(card, 'reps', true),
      lapses: requireFiniteNonNegative(card, 'lapses', true),
      learningSteps: requireFiniteNonNegative(card, 'learningSteps', true),
      state,
      lastReviewAt,
    },
  };
}

function toFsrsCard(envelope: FsrsSchedulingEnvelopeV1): Card {
  const stored = envelope.card;
  return {
    due: new Date(stored.due),
    stability: stored.stability,
    difficulty: stored.difficulty,
    elapsed_days: stored.elapsedDays,
    scheduled_days: stored.scheduledDays,
    reps: stored.reps,
    lapses: stored.lapses,
    learning_steps: stored.learningSteps,
    state: storageToState[stored.state],
    last_review: stored.lastReviewAt
      ? new Date(stored.lastReviewAt)
      : undefined,
  };
}

function fromFsrsCard(card: Card): FsrsSchedulingEnvelopeV1 {
  const state = stateToStorage[card.state];
  if (!state) {
    throw new Error('ts-fsrs returned an unsupported card state.');
  }

  return {
    kind: 'fsrs',
    schedulingSchemaVersion: 1,
    library: {
      name: 'ts-fsrs',
      major: 5,
    },
    card: {
      due: card.due.toISOString(),
      stability: card.stability,
      difficulty: card.difficulty,
      elapsedDays: card.elapsed_days,
      scheduledDays: card.scheduled_days,
      reps: card.reps,
      lapses: card.lapses,
      learningSteps: card.learning_steps,
      state,
      lastReviewAt: card.last_review?.toISOString() ?? null,
    },
  };
}

export class FsrsScheduler {
  private readonly scheduler = fsrs({ enable_fuzz: false });

  schedule(
    current: FsrsSchedulingEnvelopeV1 | null,
    rating: ReviewRating,
    reviewedAt: Date,
  ): ScheduledReviewResult {
    if (
      !(reviewedAt instanceof Date)
      || Number.isNaN(reviewedAt.getTime())
    ) {
      throw new Error('Review timestamp must be a valid Date.');
    }

    const card = current
      ? toFsrsCard(parseFsrsSchedulingEnvelope(current))
      : createEmptyCard(reviewedAt);

    const result = this.scheduler.next(
      card,
      reviewedAt,
      ratingToFsrs[rating],
    );
    const schedulingData = fromFsrsCard(result.card);

    return {
      schedulingData,
      nextReviewAt: schedulingData.card.due,
    };
  }
}
