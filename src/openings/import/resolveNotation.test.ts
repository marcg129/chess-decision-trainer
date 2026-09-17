import { describe, expect, it } from 'vitest';
import { ChessGame } from '../../core/game';
import type { ParsedPgnMove } from '../pgn/types';
import { resolveParsedMove } from './resolveNotation';

const move = (overrides: Partial<ParsedPgnMove>): ParsedPgnMove => ({
  turn: 'w',
  moveNumber: 1,
  piece: 'p',
  to: 'e4',
  capture: false,
  castle: null,
  annotations: [],
  variations: [],
  ...overrides,
});

describe('resolveParsedMove', () => {
  it('resolves parser notation against legal chess moves', () => {
    expect(resolveParsedMove(new ChessGame(), move({}))).toEqual({ from: 'e2', to: 'e4' });
  });

  it('resolves castling and promotion through legal moves', () => {
    const castleGame = new ChessGame('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    expect(resolveParsedMove(castleGame, move({ piece: 'k', to: undefined, castle: 'kingside' })))
      .toEqual({ from: 'e1', to: 'g1' });

    const promotionGame = new ChessGame('8/P7/8/8/8/8/8/k6K w - - 0 1');
    expect(resolveParsedMove(promotionGame, move({ to: 'a8', promotion: 'q' })))
      .toEqual({ from: 'a7', to: 'a8', promotion: 'q' });
  });

  it('rejects notation that does not resolve to exactly one legal move', () => {
    expect(() => resolveParsedMove(new ChessGame(), move({ to: 'e5' }))).toThrow(/resolve/i);
  });
});
