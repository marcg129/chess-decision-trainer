import { useEffect, useMemo, useState } from 'react';
import '../openingTraining.css';
import { DEMO_REPERTOIRE_ID } from '../openings/demoPgn';
import type { OpeningTrainingMode } from '../openings/training/types';
import {
  getBrowserOpeningTrainingService,
  getBrowserReviewTrainingService,
} from '../persistence/browserRepository';
import type { OpeningTrainingService } from '../services/openingTrainingService';
import type {
  ReviewOverview,
  ReviewTrainingService,
} from '../services/reviewTrainingService';
import type { EntityId, Repertoire } from '../training/types';

export type TrainingLaunchRequest = {
  repertoireId: EntityId;
  mode: OpeningTrainingMode;
};

export type ReviewLaunchRequest = {
  repertoireId?: EntityId;
};

type OpeningTrainingHomeProps = {
  service?: OpeningTrainingService;
  reviewService?: ReviewTrainingService;
  onLaunch: (request: TrainingLaunchRequest) => void;
  onReview: (request: ReviewLaunchRequest) => void;
  onImport: () => void;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to load opening repertoires.';
}

function validSettings(newItemsPerDay: number, batchSize: number): boolean {
  return Number.isInteger(newItemsPerDay)
    && newItemsPerDay >= 0
    && newItemsPerDay <= 100
    && Number.isInteger(batchSize)
    && batchSize >= 1
    && batchSize <= 100;
}

export function OpeningTrainingHome({
  service,
  reviewService,
  onLaunch,
  onReview,
  onImport,
}: OpeningTrainingHomeProps) {
  const client = useMemo(() => service ?? getBrowserOpeningTrainingService(), [service]);
  const reviewClient = useMemo(
    () => reviewService ?? getBrowserReviewTrainingService(),
    [reviewService],
  );
  const [repertoires, setRepertoires] = useState<Repertoire[]>([]);
  const [selectedId, setSelectedId] = useState<EntityId | null>(null);
  const [reviewFilterId, setReviewFilterId] = useState<EntityId | ''>('');
  const [reviewOverview, setReviewOverview] = useState<ReviewOverview | null>(null);
  const [newItemsPerDay, setNewItemsPerDay] = useState('10');
  const [batchSize, setBatchSize] = useState('15');
  const [loading, setLoading] = useState(true);
  const [reviewLoading, setReviewLoading] = useState(true);
  const [demoBusy, setDemoBusy] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const items = (await client.listRepertoires()).filter((item) => !item.archived);
        if (!active) return;
        setRepertoires(items);
        setSelectedId((current) => {
          if (current && items.some((item) => item.id === current)) return current;
          return items[0]?.id ?? null;
        });
        setReviewFilterId((current) =>
          current && !items.some((item) => item.id === current) ? '' : current);
      } catch (caught) {
        if (active) setError(errorMessage(caught));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [client]);

  useEffect(() => {
    let active = true;
    setReviewLoading(true);
    void (async () => {
      try {
        const overview = await reviewClient.getOverview(
          reviewFilterId ? { repertoireId: reviewFilterId } : {},
        );
        if (!active) return;
        setReviewOverview(overview);
        setNewItemsPerDay(String(overview.settings.newItemsPerDay));
        setBatchSize(String(overview.settings.batchSize));
      } catch (caught) {
        if (active) setError(errorMessage(caught));
      } finally {
        if (active) setReviewLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [reviewClient, reviewFilterId]);

  const launch = (mode: OpeningTrainingMode) => {
    if (!selectedId) return;
    onLaunch({ repertoireId: selectedId, mode });
  };

  const launchDemo = async () => {
    setDemoBusy(true);
    setError(null);
    try {
      await client.ensureDemoRepertoire();
      onLaunch({ repertoireId: DEMO_REPERTOIRE_ID, mode: 'practice-line' });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setDemoBusy(false);
    }
  };

  const parsedNewItems = Number(newItemsPerDay);
  const parsedBatchSize = Number(batchSize);
  const settingsAreValid = validSettings(parsedNewItems, parsedBatchSize);

  const saveReviewSettings = async () => {
    if (!settingsAreValid) return;
    setSettingsBusy(true);
    setError(null);
    try {
      const settings = await reviewClient.updateSettings({
        newItemsPerDay: parsedNewItems,
        batchSize: parsedBatchSize,
      });
      setNewItemsPerDay(String(settings.newItemsPerDay));
      setBatchSize(String(settings.batchSize));
      setReviewOverview((current) =>
        current ? { ...current, settings } : current);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSettingsBusy(false);
    }
  };

  const reviewCount = (reviewOverview?.dueCount ?? 0)
    + (reviewOverview?.newAvailable ?? 0);

  return (
    <section className="opening-home" aria-labelledby="opening-home-heading">
      <div className="opening-home__header">
        <div>
          <p className="panel-kicker">Phase 4 · Adaptive opening trainer</p>
          <h2 id="opening-home-heading">Opening training</h2>
          <p>Practice lines, drill weak positions, or review what is due today.</p>
        </div>
        <button type="button" onClick={onImport}>Import PGN</button>
      </div>

      {error && <p className="opening-training__alert" role="alert">{error}</p>}

      {loading ? (
        <p className="empty-state">Loading repertoires…</p>
      ) : repertoires.length === 0 ? (
        <div className="opening-home__empty">
          <p>No opening repertoires yet. Import a PGN or use the demo to start practicing.</p>
        </div>
      ) : (
        <div className="opening-home__repertoires" role="radiogroup" aria-label="Opening repertoire">
          {repertoires.map((repertoire) => (
            <label
              className={`opening-home__repertoire${selectedId === repertoire.id ? ' is-selected' : ''}`}
              key={repertoire.id}
            >
              <input
                type="radio"
                name="opening-repertoire"
                value={repertoire.id}
                checked={selectedId === repertoire.id}
                onChange={() => setSelectedId(repertoire.id)}
              />
              <span>
                <strong>{repertoire.name}</strong>
                <small>{repertoire.side === 'white' ? 'White' : repertoire.side === 'black' ? 'Black' : 'Mixed'} repertoire</small>
              </span>
            </label>
          ))}
        </div>
      )}

      <section className="opening-home__review" aria-labelledby="review-due-heading">
        <div className="opening-home__review-heading">
          <div>
            <p className="panel-kicker">Spaced repetition</p>
            <h3 id="review-due-heading">Review Due</h3>
          </div>
          <strong aria-live="polite">
            {reviewLoading || !reviewOverview
              ? 'Loading review queue…'
              : `${reviewOverview.dueCount} due · ${reviewOverview.newAvailable} new available`}
          </strong>
        </div>

        <label>
          <span>Review repertoire filter</span>
          <select
            value={reviewFilterId}
            onChange={(event) => setReviewFilterId(event.target.value)}
          >
            <option value="">All active repertoires</option>
            {repertoires.map((repertoire) => (
              <option key={repertoire.id} value={repertoire.id}>
                {repertoire.name}
              </option>
            ))}
          </select>
        </label>

        <div className="opening-home__review-settings">
          <label>
            <span>New items per day</span>
            <input
              type="number"
              min="0"
              max="100"
              step="1"
              value={newItemsPerDay}
              onChange={(event) => setNewItemsPerDay(event.target.value)}
            />
          </label>
          <label>
            <span>Review batch size</span>
            <input
              type="number"
              min="1"
              max="100"
              step="1"
              value={batchSize}
              onChange={(event) => setBatchSize(event.target.value)}
            />
          </label>
          <button
            type="button"
            onClick={() => void saveReviewSettings()}
            disabled={!settingsAreValid || settingsBusy}
          >
            {settingsBusy ? 'Saving…' : 'Save review settings'}
          </button>
        </div>

        <button
          type="button"
          className="opening-home__primary"
          onClick={() =>
            onReview(reviewFilterId ? { repertoireId: reviewFilterId } : {})}
          disabled={reviewLoading || reviewCount === 0}
        >
          Review Due
        </button>
      </section>

      <div className="opening-home__actions">
        <button
          type="button"
          className="opening-home__primary"
          onClick={() => launch('practice-line')}
          disabled={!selectedId}
        >
          Practice Line
        </button>
        <button
          type="button"
          onClick={() => launch('quick-recall')}
          disabled={!selectedId}
        >
          Quick Recall
        </button>
        <button type="button" onClick={() => void launchDemo()} disabled={demoBusy}>
          {demoBusy ? 'Loading demo…' : 'Try Demo'}
        </button>
      </div>
    </section>
  );
}
