import { useEffect, useMemo, useState } from 'react';
import { DEMO_REPERTOIRE_ID } from '../openings/demoPgn';
import type { OpeningTrainingMode } from '../openings/training/types';
import { getBrowserOpeningTrainingService } from '../persistence/browserRepository';
import type { OpeningTrainingService } from '../services/openingTrainingService';
import type { EntityId, Repertoire } from '../training/types';

export type TrainingLaunchRequest = {
  repertoireId: EntityId;
  mode: OpeningTrainingMode;
};

type OpeningTrainingHomeProps = {
  service?: OpeningTrainingService;
  onLaunch: (request: TrainingLaunchRequest) => void;
  onImport: () => void;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to load opening repertoires.';
}

export function OpeningTrainingHome({
  service,
  onLaunch,
  onImport,
}: OpeningTrainingHomeProps) {
  const client = useMemo(() => service ?? getBrowserOpeningTrainingService(), [service]);
  const [repertoires, setRepertoires] = useState<Repertoire[]>([]);
  const [selectedId, setSelectedId] = useState<EntityId | null>(null);
  const [loading, setLoading] = useState(true);
  const [demoBusy, setDemoBusy] = useState(false);
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

  return (
    <section className="opening-home" aria-labelledby="opening-home-heading">
      <div className="opening-home__header">
        <div>
          <p className="panel-kicker">Phase 3 · Opening trainer</p>
          <h2 id="opening-home-heading">Opening training</h2>
          <p>Practice complete lines or jump straight to recall positions.</p>
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
