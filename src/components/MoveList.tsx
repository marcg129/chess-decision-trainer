import type { MoveDecisionRecord } from '../core/trainingTypes';

function formatThinkTime(ms: number | null): string {
  if (ms === null) return '—';
  return `${(ms / 1000).toFixed(1)}s`;
}

export function MoveList({ records }: { records: MoveDecisionRecord[] }) {
  if (records.length === 0) {
    return <p className="empty-state">No moves yet.</p>;
  }

  const rows: MoveDecisionRecord[][] = [];
  for (let index = 0; index < records.length; index += 2) {
    rows.push(records.slice(index, index + 2));
  }

  return (
    <ol className="move-list" aria-label="Move history">
      {rows.map((row, rowIndex) => (
        <li className="move-row" key={row[0]?.ply ?? rowIndex}>
          <span className="move-number">{rowIndex + 1}.</span>
          {row.map((record) => (
            <span className="move-entry" key={record.ply}>
              <span>{record.san}</span>
              <small>{formatThinkTime(record.decisionTimeMs)}</small>
            </span>
          ))}
        </li>
      ))}
    </ol>
  );
}
