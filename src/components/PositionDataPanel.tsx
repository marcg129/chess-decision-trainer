import { useState } from 'react';

type PositionDataPanelProps = {
  fen: string;
  positionKey: string;
  pgn: string;
};

export function PositionDataPanel({ fen, positionKey, pgn }: PositionDataPanelProps) {
  const [copyStatus, setCopyStatus] = useState('');
  const pgnValue = pgn.trim() === '' ? 'No moves yet.' : pgn;

  const copyText = async (label: string, value: string) => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard API unavailable');
      }
      await navigator.clipboard.writeText(value);
      setCopyStatus(`Copied ${label}`);
    } catch {
      setCopyStatus('Clipboard unavailable');
    }
  };

  return (
    <section className="position-data" aria-labelledby="position-data-heading">
      <div className="panel-heading-row">
        <div>
          <p className="panel-kicker">Interoperability</p>
          <h2 id="position-data-heading">Position data</h2>
        </div>
        <span className="data-badge">Live</span>
      </div>

      <div className="data-field">
        <div className="data-field__heading">
          <label htmlFor="position-fen">FEN</label>
          <button type="button" onClick={() => copyText('FEN', fen)}>
            Copy FEN
          </button>
        </div>
        <textarea id="position-fen" value={fen} readOnly rows={3} />
      </div>

      <div className="data-field">
        <div className="data-field__heading">
          <label htmlFor="position-key">Position key</label>
          <button type="button" onClick={() => copyText('position key', positionKey)}>
            Copy key
          </button>
        </div>
        <textarea id="position-key" value={positionKey} readOnly rows={3} />
      </div>

      <div className="data-field">
        <div className="data-field__heading">
          <label htmlFor="position-pgn">PGN</label>
          <button
            type="button"
            onClick={() => copyText('PGN', pgn)}
            disabled={pgn.trim() === ''}
          >
            Copy PGN
          </button>
        </div>
        <textarea id="position-pgn" value={pgnValue} readOnly rows={5} />
      </div>

      <p className="copy-status" role="status" aria-live="polite">
        {copyStatus}
      </p>
    </section>
  );
}
