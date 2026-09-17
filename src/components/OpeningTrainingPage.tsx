import { useMemo, useState } from 'react';
import type { OpeningTrainingMode } from '../openings/training/types';
import { getBrowserOpeningTrainingService } from '../persistence/browserRepository';
import type { OpeningTrainingService } from '../services/openingTrainingService';
import type { EntityId } from '../training/types';
import { OpeningTrainer } from './OpeningTrainer';
import { OpeningTrainingHome, type TrainingLaunchRequest } from './OpeningTrainingHome';
import { PgnImportPanel } from './PgnImportPanel';

type TrainView =
  | { kind: 'home' }
  | { kind: 'import' }
  | { kind: 'session'; repertoireId: EntityId; mode: OpeningTrainingMode };

export function OpeningTrainingPage({ service }: { service?: OpeningTrainingService }) {
  const client = useMemo(() => service ?? getBrowserOpeningTrainingService(), [service]);
  const [view, setView] = useState<TrainView>({ kind: 'home' });

  const launch = ({ repertoireId, mode }: TrainingLaunchRequest) => {
    setView({ kind: 'session', repertoireId, mode });
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

  return (
    <OpeningTrainingHome
      service={client}
      onLaunch={launch}
      onImport={() => setView({ kind: 'import' })}
    />
  );
}
