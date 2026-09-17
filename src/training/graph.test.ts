import { InvalidChessEdgeError } from './errors';
import { deriveTransition } from './graph';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

test('derives a canonical legal move transition', () => {
  const result = deriveTransition(START_FEN, { from: 'e2', to: 'e4' });

  expect(result.san).toBe('e4');
  expect(result.moveKey).toBe('e2e4');
  expect(result.fromPositionKey).toContain(' w KQkq ');
  expect(result.toPositionKey).toContain(' b KQkq ');
  expect(result.toFen).not.toBe(START_FEN);
});

test('rejects an illegal transition', () => {
  expect(() => deriveTransition(START_FEN, { from: 'e2', to: 'e5' })).toThrow(
    InvalidChessEdgeError,
  );
});
