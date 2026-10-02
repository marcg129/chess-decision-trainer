import { buildReviewQueue, type ReviewSessionPlan } from '../review/queue';
import { normalizeReviewSettings } from '../review/settings';
import type { ReviewSettings } from '../review/types';
import type {
  ReviewInventory,
  TrainingRepository,
} from '../training/repositories';
import type { EntityId, LearnerProfile } from '../training/types';

type ReviewRepository = Pick<
  TrainingRepository,
  | 'ensureLocalLearner'
  | 'loadReviewInventory'
  | 'countNewReviewIntroductions'
  | 'updateReviewSettings'
>;

export type ReviewOverview = {
  dueCount: number;
  newAvailable: number;
  settings: ReviewSettings;
};

export type ReviewTrainingServiceOptions = {
  now?: () => Date;
  localDayBounds?: (now: Date) => {
    startIso: string;
    endIso: string;
  };
};

function browserLocalDayBounds(now: Date): {
  startIso: string;
  endIso: string;
} {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

export class ReviewTrainingService {
  private readonly now: () => Date;
  private readonly localDayBounds: (now: Date) => {
    startIso: string;
    endIso: string;
  };

  constructor(
    private readonly training: ReviewRepository,
    options: ReviewTrainingServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.localDayBounds = options.localDayBounds ?? browserLocalDayBounds;
  }

  async getOverview(input: {
    repertoireId?: EntityId;
  } = {}): Promise<ReviewOverview> {
    const context = await this.loadContext(input.repertoireId);
    return {
      dueCount: context.inventory.due.length,
      newAvailable: Math.min(
        context.inventory.newCandidates.length,
        Math.max(
          0,
          context.settings.newItemsPerDay - context.newIntroductionsToday,
        ),
      ),
      settings: context.settings,
    };
  }

  async updateSettings(settings: ReviewSettings): Promise<ReviewSettings> {
    const normalized = normalizeReviewSettings(settings);
    const learner = await this.training.updateReviewSettings(normalized);
    return normalizeReviewSettings(learner.reviewSettings);
  }

  async createSessionPlan(input: {
    repertoireId?: EntityId;
  } = {}): Promise<ReviewSessionPlan> {
    const context = await this.loadContext(input.repertoireId);
    return buildReviewQueue({
      inventory: context.inventory,
      settings: context.settings,
      newIntroductionsToday: context.newIntroductionsToday,
      ...(input.repertoireId
        ? { filterRepertoireId: input.repertoireId }
        : {}),
    });
  }

  private async loadContext(filterRepertoireId?: EntityId): Promise<{
    learner: LearnerProfile;
    inventory: ReviewInventory;
    settings: ReviewSettings;
    newIntroductionsToday: number;
  }> {
    const learner = await this.training.ensureLocalLearner('Local learner');
    const settings = normalizeReviewSettings(learner.reviewSettings);
    const now = this.now();
    const { startIso, endIso } = this.localDayBounds(now);

    const [inventory, newIntroductionsToday] = await Promise.all([
      this.training.loadReviewInventory({
        dueThroughIso: now.toISOString(),
        ...(filterRepertoireId ? { filterRepertoireId } : {}),
      }),
      this.training.countNewReviewIntroductions(startIso, endIso),
    ]);

    return {
      learner,
      inventory,
      settings,
      newIntroductionsToday,
    };
  }
}
