import { useState } from 'react';
import { AppNav, type AppSection } from './components/AppNav';
import { OpeningTrainingPage } from './components/OpeningTrainingPage';
import { PlaySurface } from './components/PlaySurface';
import { TrainingDataPanel } from './components/TrainingDataPanel';
import type { OpeningTrainingService } from './services/openingTrainingService';
import type { TrainingDataService } from './services/trainingDataService';

type AppProps = {
  initialFen?: string;
  trainingDataService?: TrainingDataService;
  openingTrainingService?: OpeningTrainingService;
};

const sectionEyebrow: Record<AppSection, string> = {
  train: 'Phase 3 · Opening training',
  play: 'Phase 1 · Timed free play',
  data: 'Phase 2 · Local training data',
};

export default function App({
  initialFen,
  trainingDataService,
  openingTrainingService,
}: AppProps) {
  const [section, setSection] = useState<AppSection>('train');

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">{sectionEyebrow[section]}</p>
          <h1>Chess Decision Trainer</h1>
        </div>
      </header>

      <AppNav current={section} onChange={setSection} />

      <section
        id={`app-panel-${section}`}
        role="tabpanel"
        aria-labelledby={`app-tab-${section}`}
        className="app-section"
      >
        {section === 'train' && (
          <OpeningTrainingPage service={openingTrainingService} />
        )}
        {section === 'play' && <PlaySurface initialFen={initialFen} />}
        {section === 'data' && (
          <div className="training-data-section">
            <TrainingDataPanel service={trainingDataService} />
          </div>
        )}
      </section>
    </main>
  );
}
