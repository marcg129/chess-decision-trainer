export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';

export type ReviewSettings = {
  newItemsPerDay: number;
  batchSize: number;
};

export type ReviewAttemptMetadata = {
  targetRepertoireMoveId: string;
  rating: ReviewRating;
  kind: 'scheduled' | 'relearning';
  schedulingApplied: boolean;
  newCard: boolean;
};
