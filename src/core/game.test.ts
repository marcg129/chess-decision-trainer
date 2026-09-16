import { ChessGame } from './game';

test('accepts legal moves and rejects illegal moves without mutation', () => {
  const game = new ChessGame();
  expect(game.move('e2', 'e4')?.san).toBe('e4');
  const beforeIllegal = game.snapshot().fen;
  expect(game.move('e2', 'e5')).toBeNull();
  expect(game.snapshot().fen).toBe(beforeIllegal);
});

test('supports castling and en passant', () => {
  const castle = new ChessGame('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  expect(castle.move('e1', 'g1')?.san).toContain('O-O');

  const ep = new ChessGame('8/8/8/3pP3/8/8/8/K6k w - d6 0 1');
  expect(ep.move('e5', 'd6')?.flags).toContain('e');
});

test.each(['q', 'r', 'b', 'n'] as const)('supports %s promotion', (promotion) => {
  const game = new ChessGame('7k/P7/8/8/8/8/8/K7 w - - 0 1');
  expect(game.requiresPromotion('a7', 'a8')).toBe(true);
  expect(game.move('a7', 'a8', promotion)).not.toBeNull();
  expect(game.pieceAt('a8')?.type).toBe(promotion);
});

test('reports checkmate after Fools Mate', () => {
  const game = new ChessGame();
  game.move('f2', 'f3');
  game.move('e7', 'e5');
  game.move('g2', 'g4');
  game.move('d8', 'h4');
  const snapshot = game.snapshot();
  expect(snapshot.status).toBe('checkmate');
  expect(snapshot.inCheck).toBe(true);
});

test('distinguishes stalemate, insufficient material, fifty-move draw, and threefold repetition', () => {
  expect(new ChessGame('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1').snapshot().status).toBe('stalemate');
  expect(new ChessGame('8/8/8/8/8/8/8/K6k w - - 0 1').snapshot().status).toBe('insufficient-material');
  expect(new ChessGame('8/8/8/8/8/8/6R1/K6k w - - 100 75').snapshot().status).toBe('draw');

  const repetition = new ChessGame();
  for (const [from, to] of [
    ['g1', 'f3'], ['g8', 'f6'], ['f3', 'g1'], ['f6', 'g8'],
    ['g1', 'f3'], ['g8', 'f6'], ['f3', 'g1'], ['f6', 'g8'],
  ] as const) {
    expect(repetition.move(from, to)).not.toBeNull();
  }
  expect(repetition.snapshot().status).toBe('threefold-repetition');
});

test('normalizes transposed move orders to the same training position key', () => {
  const a = new ChessGame();
  a.move('g1', 'f3'); a.move('g8', 'f6'); a.move('g2', 'g3'); a.move('g7', 'g6');

  const b = new ChessGame();
  b.move('g2', 'g3'); b.move('g7', 'g6'); b.move('g1', 'f3'); b.move('g8', 'f6');

  expect(a.snapshot().positionKey).toBe(b.snapshot().positionKey);
});

test('undo, reset, FEN load, and PGN load update the authoritative state', () => {
  const game = new ChessGame();
  game.move('e2', 'e4');
  expect(game.undo()?.san).toBe('e4');
  expect(game.snapshot().history).toHaveLength(0);

  game.loadFen('8/8/8/8/8/8/8/K6k w - - 0 1');
  expect(game.snapshot().status).toBe('insufficient-material');

  game.reset();
  game.loadPgn('1. e4 e5 2. Nf3');
  expect(game.snapshot().history.map((move) => move.san)).toEqual(['e4', 'e5', 'Nf3']);
});
