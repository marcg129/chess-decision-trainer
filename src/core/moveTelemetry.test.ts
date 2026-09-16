import { ChessGame } from './game';
import { createMoveDecisionRecord } from './moveTelemetry';

test('creates a deterministic record from verified move and timing data', () => {
  const game = new ChessGame();
  const before = game.snapshot();
  const move = game.move('e2', 'e4')!;
  const after = game.snapshot();
  const record = createMoveDecisionRecord({
    ply: 1,
    move,
    before,
    after,
    timing: { decisionTimeMs: 1200, clockAfterMs: 180800 },
  });

  expect(record).toMatchObject({
    ply: 1,
    mover: 'w',
    san: 'e4',
    from: 'e2',
    to: 'e4',
    fenBefore: before.fen,
    fenAfter: after.fen,
    positionKeyBefore: before.positionKey,
    positionKeyAfter: after.positionKey,
    decisionTimeMs: 1200,
    clockAfterMs: 180800,
  });
  expect(record.lan).toBe(move.lan);
});
