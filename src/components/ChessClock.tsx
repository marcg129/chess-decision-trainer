import type { Color } from 'chess.js';

function formatClock(ms: number): string {
  const safeMs = Math.max(0, ms);
  const minutes = Math.floor(safeMs / 60_000);
  const seconds = Math.floor((safeMs % 60_000) / 1000);
  const tenths = Math.floor((safeMs % 1000) / 100);
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${tenths}`;
}

export function ChessClock({
  color,
  ms,
  active,
  running,
  flagged,
}: {
  color: Color;
  ms: number;
  active: boolean;
  running: boolean;
  flagged: boolean;
}) {
  const name = color === 'w' ? 'White' : 'Black';
  return (
    <div className={`clock${active ? ' clock--active' : ''}${flagged ? ' clock--flagged' : ''}`}>
      <span className="clock__player">{name}</span>
      <strong className="clock__time" aria-label={`${name} clock ${formatClock(ms)}`}>
        {formatClock(ms)}
      </strong>
      <span className="clock__state">{flagged ? 'Time' : active && running ? 'Thinking' : ''}</span>
    </div>
  );
}
