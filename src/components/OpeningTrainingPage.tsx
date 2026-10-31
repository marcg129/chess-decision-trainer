import { useMemo, useState } from 'react';
import type { OpeningTrainingMode } from '../openings/training/types';
import {
  getBrowserOpeningTrainingService,
  getBrowserReviewTrainingService,
} from '../persistence/browserRepository';
import type { OpeningTrainingService } from '../services/openingTrainingService';
import type { ReviewTrainingService } from '../services/reviewTrainingService';
import type { EntityId } from '../training/types';
import { OpeningTrainer } from './OpeningTrainer';
import {
  OpeningTrainingHome,
  type ReviewLaunchRequest,
  type TrainingLaunchRequest,
} from './OpeningTrainingHome';
import { PgnImportPanel } from './PgnImportPanel';
import { ReviewTrainer } from './ReviewTrainer';

type TrainView =
  | { kind: 'home' }
  | { kind: 'import' }
  | { kind: 'session'; repertoireId: EntityId; mode: OpeningTrainingMode }
  | { kind: 'review'; repertoireId?: EntityId };

type OpeningTrainingPageProps = {
  service?: OpeningTrainingService;
  reviewService?: ReviewTrainingService;
};

export function OpeningTrainingPage({
  service,
  reviewService,
}: OpeningTrainingPageProps) {
  const client = useMemo(
    () => service ?? getBrowserOpeningTrainingService(),
    [service],
  );
  const reviewClient = useMemo(
    () => reviewService ?? getBrowserReviewTrainingService(),
    [reviewService],
  );
  const [view, setView] = useState<TrainView>({ kind: 'home' });

  const launch = ({ repertoireId, mode }: TrainingLaunchRequest) => {
    setView({ kind: 'session', repertoireId, mode });
  };

  const launchReview = ({ repertoireId }: ReviewLaunchRequest) => {
    setView(repertoireId
      ? { kind: 'review', repertoireId }
      : { kind: 'review' });
  };

  if (view.kind === 'import') {
    return (
      <PgnImportPanel
        service={client}
        onCancel={() => setView({ kind: 'home' })}
        onImported={() => setView({ kind: 'home' })}
      />
    );
  }

  if (view.kind === 'session') {
    return (
      <OpeningTrainer
        service={client}
        repertoireId={view.repertoireId}
        mode={view.mode}
        onExit={() => setView({ kind: 'home' })}
      />
    );
  }

  if (view.kind === 'review') {
    return (
      <ReviewTrainer
        service={reviewClient}
        {...(view.repertoireId ? { repertoireId: view.repertoireId } : {})}
        onExit={() => setView({ kind: 'home' })}
      />
    );
  }

  return (
    <OpeningTrainingHome
      service={client}
      reviewService={reviewClient}
      onLaunch={launch}
      onReview={launchReview}
      onImport={() => setView({ kind: 'import' })}
    />
  );
}
