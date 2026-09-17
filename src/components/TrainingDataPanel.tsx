import { useEffect, useMemo, useState } from 'react';
import { getBrowserTrainingDataService } from '../persistence/browserRepository';
import type { TrainingDataService } from '../services/trainingDataService';
import type { TrainingBackupV1, TrainingDataSummary } from '../training/types';
import { readFileText } from '../utils/readFileText';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Training data operation failed.';
}

function backupCounts(backup: TrainingBackupV1) {
  return {
    repertoires: backup.data.repertoires.length,
    positions: backup.data.positions.length,
    attempts: backup.data.trainingAttempts.length,
  };
}

function downloadBackup(backup: TrainingBackupV1, prefix: string): void {
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export function TrainingDataPanel({ service }: { service?: TrainingDataService }) {
  const client = useMemo(() => service ?? getBrowserTrainingDataService(), [service]);
  const [summary, setSummary] = useState<TrainingDataSummary | null>(null);
  const [pendingBackup, setPendingBackup] = useState<TrainingBackupV1 | null>(null);
  const [preRestoreBackup, setPreRestoreBackup] = useState<TrainingBackupV1 | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [nextSummary, recovery] = await Promise.all([
          client.initialize(),
          client.getPreRestoreBackup(),
        ]);
        if (!active) return;
        setSummary(nextSummary);
        setPreRestoreBackup(recovery);
      } catch (caught) {
        if (active) setError(errorMessage(caught));
      }
    })();
    return () => {
      active = false;
    };
  }, [client]);

  const handleExport = async () => {
    setError(null);
    try {
      const backup = await client.exportBackup();
      downloadBackup(backup, 'chess-decision-trainer-backup');
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const handleFile = async (file: File | undefined) => {
    setError(null);
    setPendingBackup(null);
    if (!file) return;

    try {
      const text = await readFileText(file);
      const parsed = JSON.parse(text) as unknown;
      setPendingBackup(client.validateBackup(parsed));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const handleRestore = async () => {
    if (!pendingBackup) return;
    setBusy(true);
    setError(null);
    try {
      const nextSummary = await client.restoreBackup(pendingBackup);
      setSummary(nextSummary);
      setPendingBackup(null);
      setPreRestoreBackup(await client.getPreRestoreBackup());
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    setBusy(true);
    setError(null);
    try {
      setSummary(await client.reset());
      setPendingBackup(null);
      setConfirmReset(false);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="training-data panel-section" aria-labelledby="training-data-heading">
      <div className="panel-heading-row">
        <div>
          <p className="panel-kicker">Phase 2 · Browser-local persistence</p>
          <h2 id="training-data-heading">Training data</h2>
        </div>
        {summary && <span className="data-badge">Schema {summary.schemaVersion}</span>}
      </div>

      {error && <p className="training-data__alert" role="alert">{error}</p>}

      {!summary ? (
        <p className="empty-state">Loading local training data…</p>
      ) : (
        <>
          <div className="training-data__overview">
            <div>
              <span className="training-data__label">Learner</span>
              <strong>{summary.learner.displayName}</strong>
            </div>
            <div>
              <span className="training-data__label">Stored</span>
              <strong>
                {summary.counts.repertoires} repertoires · {summary.counts.positions} positions ·{' '}
                {summary.counts.moveEdges} moves
              </strong>
            </div>
            <div>
              <span className="training-data__label">Practice history</span>
              <strong>
                {summary.counts.attempts} attempts · {summary.counts.sessions} sessions
              </strong>
            </div>
            <div>
              <span className="training-data__label">Last activity</span>
              <strong>{summary.lastActivityAt ?? 'No attempts yet'}</strong>
            </div>
          </div>

          <div className="training-data__repertoires">
            <h3>Repertoires</h3>
            {summary.repertoires.length === 0 ? (
              <p className="empty-state">No repertoires stored yet.</p>
            ) : (
              <ul>
                {summary.repertoires.map((repertoire) => (
                  <li key={repertoire.id}>
                    <strong>{repertoire.name}</strong>
                    <span>
                      {repertoire.positions} positions · {repertoire.moves} moves ·{' '}
                      {repertoire.attempts} attempts
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      <div className="training-data__actions">
        <button type="button" onClick={() => void handleExport()} disabled={!summary || busy}>
          Export backup
        </button>
        {preRestoreBackup && (
          <button
            type="button"
            onClick={() =>
              downloadBackup(preRestoreBackup, 'chess-decision-trainer-pre-restore')
            }
            disabled={busy}
          >
            Download pre-restore backup
          </button>
        )}
      </div>

      <div className="training-data__restore">
        <label htmlFor="training-backup-file">Restore backup file</label>
        <input
          id="training-backup-file"
          type="file"
          accept="application/json,.json"
          onChange={(event) => void handleFile(event.currentTarget.files?.[0])}
          disabled={busy}
        />
        {pendingBackup && (
          <div className="training-data__confirmation">
            <p>
              Valid backup: {backupCounts(pendingBackup).repertoires} repertoires ·{' '}
              {backupCounts(pendingBackup).positions} positions ·{' '}
              {backupCounts(pendingBackup).attempts} attempts. Restoring will replace current
              local training data.
            </p>
            <button type="button" onClick={() => void handleRestore()} disabled={busy}>
              Replace local data
            </button>
          </div>
        )}
      </div>

      <div className="training-data__reset">
        {!confirmReset ? (
          <button
            type="button"
            className="button-danger"
            onClick={() => setConfirmReset(true)}
            disabled={busy}
          >
            Reset local data
          </button>
        ) : (
          <div className="training-data__confirmation">
            <p>This clears all local training data and creates a fresh local learner.</p>
            <div className="training-data__actions">
              <button type="button" className="button-danger" onClick={() => void handleReset()} disabled={busy}>
                Confirm reset
              </button>
              <button type="button" onClick={() => setConfirmReset(false)} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
