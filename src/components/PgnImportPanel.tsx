import { useMemo, useState } from 'react';
import '../openingTraining.css';
import type { ImportSide, RepertoireImportPlan } from '../openings/import/types';
import type { ParsedPgnDocument, ParsedPgnGame } from '../openings/pgn/types';
import { getBrowserOpeningTrainingService } from '../persistence/browserRepository';
import type { OpeningTrainingService } from '../services/openingTrainingService';
import type { Repertoire } from '../training/types';
import { readFileText } from '../utils/readFileText';

type ImportStage = 'file' | 'select' | 'preview' | 'saving';

type PgnImportPanelProps = {
  service?: OpeningTrainingService;
  onImported: (repertoire: Repertoire) => void;
  onCancel: () => void;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'PGN import failed.';
}

function gameLabel(game: ParsedPgnGame): string {
  const event = game.tags.Event?.trim();
  if (event) return event;
  const white = game.tags.White?.trim();
  const black = game.tags.Black?.trim();
  if (white && black) return `${white} vs ${black}`;
  return `Game ${game.index + 1}`;
}

export function PgnImportPanel({ service, onImported, onCancel }: PgnImportPanelProps) {
  const client = useMemo(() => service ?? getBrowserOpeningTrainingService(), [service]);
  const [stage, setStage] = useState<ImportStage>('file');
  const [document, setDocument] = useState<ParsedPgnDocument | null>(null);
  const [selectedGameIndexes, setSelectedGameIndexes] = useState<number[]>([]);
  const [name, setName] = useState('Imported repertoire');
  const [side, setSide] = useState<ImportSide>('white');
  const [plan, setPlan] = useState<RepertoireImportPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const chooseFile = async (file: File | undefined) => {
    setError(null);
    setPlan(null);
    if (!file) return;
    try {
      const parsed = client.parsePgn(await readFileText(file));
      if (parsed.games.length === 0) throw new Error('PGN did not contain any games.');
      setDocument(parsed);
      setSelectedGameIndexes(parsed.games.map((game) => game.index));
      const firstEvent = parsed.games[0]?.tags.Event?.trim();
      setName(firstEvent || 'Imported repertoire');
      setStage('select');
    } catch (caught) {
      setDocument(null);
      setSelectedGameIndexes([]);
      setStage('file');
      setError(errorMessage(caught));
    }
  };

  const toggleGame = (index: number) => {
    setSelectedGameIndexes((current) =>
      current.includes(index)
        ? current.filter((value) => value !== index)
        : [...current, index].sort((a, b) => a - b),
    );
    setPlan(null);
  };

  const preview = () => {
    if (!document || selectedGameIndexes.length === 0 || !name.trim()) return;
    setError(null);
    try {
      const nextPlan = client.previewImport({
        document,
        name: name.trim(),
        side,
        selectedGameIndexes: [...selectedGameIndexes].sort((a, b) => a - b),
      });
      setPlan(nextPlan);
      setStage('preview');
    } catch (caught) {
      setPlan(null);
      setError(errorMessage(caught));
    }
  };

  const save = async () => {
    if (!plan) return;
    setStage('saving');
    setError(null);
    try {
      const repertoire = await client.commitImport(plan);
      onImported(repertoire);
    } catch (caught) {
      setError(errorMessage(caught));
      setStage('preview');
    }
  };

  return (
    <section className="pgn-import" aria-labelledby="pgn-import-heading">
      <div className="pgn-import__header">
        <div>
          <p className="panel-kicker">Opening repertoire</p>
          <h2 id="pgn-import-heading">Import PGN</h2>
        </div>
        <button type="button" onClick={onCancel} disabled={stage === 'saving'}>Cancel</button>
      </div>

      {error && <p className="opening-training__alert" role="alert">{error}</p>}

      <div className="pgn-import__file">
        <label htmlFor="opening-pgn-file">PGN file</label>
        <input
          id="opening-pgn-file"
          type="file"
          accept=".pgn,application/x-chess-pgn,text/plain"
          onChange={(event) => void chooseFile(event.currentTarget.files?.[0])}
          disabled={stage === 'saving'}
        />
      </div>

      {document && stage !== 'file' && (
        <>
          <fieldset className="pgn-import__games" disabled={stage === 'saving'}>
            <legend>Games to import</legend>
            {document.games.map((game) => (
              <label key={game.index}>
                <input
                  type="checkbox"
                  checked={selectedGameIndexes.includes(game.index)}
                  onChange={() => toggleGame(game.index)}
                />
                <span>{gameLabel(game)}</span>
              </label>
            ))}
          </fieldset>

          <div className="pgn-import__settings">
            <label htmlFor="opening-repertoire-name">Repertoire name</label>
            <input
              id="opening-repertoire-name"
              value={name}
              onChange={(event) => {
                setName(event.currentTarget.value);
                setPlan(null);
              }}
              disabled={stage === 'saving'}
            />

            <fieldset disabled={stage === 'saving'}>
              <legend>Train as</legend>
              <label>
                <input
                  type="radio"
                  name="opening-import-side"
                  checked={side === 'white'}
                  onChange={() => {
                    setSide('white');
                    setPlan(null);
                  }}
                />
                White
              </label>
              <label>
                <input
                  type="radio"
                  name="opening-import-side"
                  checked={side === 'black'}
                  onChange={() => {
                    setSide('black');
                    setPlan(null);
                  }}
                />
                Black
              </label>
            </fieldset>
          </div>

          {stage !== 'preview' && stage !== 'saving' && (
            <div className="pgn-import__actions">
              <button
                type="button"
                onClick={preview}
                disabled={selectedGameIndexes.length === 0 || !name.trim()}
              >
                Preview import
              </button>
            </div>
          )}
        </>
      )}

      {plan && (stage === 'preview' || stage === 'saving') && (
        <div className="pgn-import__preview">
          <h3>Import preview</h3>
          <div className="pgn-import__counts">
            <span><strong>{plan.counts.games}</strong> games</span>
            <span><strong>{plan.counts.positions}</strong> positions</span>
            <span><strong>{plan.counts.moves}</strong> moves</span>
          </div>

          {plan.warnings.length > 0 && (
            <div className="pgn-import__warnings" aria-label="Import warnings">
              {plan.warnings.map((warning, index) => (
                <p key={`${warning.code}-${index}`}>{warning.message}</p>
              ))}
            </div>
          )}

          <div className="pgn-import__actions">
            <button type="button" onClick={() => setStage('select')} disabled={stage === 'saving'}>
              Edit selection
            </button>
            <button type="button" onClick={() => void save()} disabled={stage === 'saving'}>
              {stage === 'saving' ? 'Creating…' : 'Create repertoire'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
