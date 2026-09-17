import { describe, expect, it } from 'vitest';
import { parsePgnSource } from './parsePgn';

describe('parsePgnSource', () => {
  it('normalizes multiple games, nested variations, and comments', () => {
    const parsed = parsePgnSource(`
[Event "One"]
[Result "*"]
1. e4 {King pawn} e5 (1... c5 (1... e6)) 2. Nf3 *

[Event "Two"]
[Result "*"]
1. d4 d5 2. c4 *
`);

    expect(parsed.games).toHaveLength(2);
    expect(parsed.games[0].moves[0]).toMatchObject({
      turn: 'w',
      moveNumber: 1,
      piece: 'p',
      to: 'e4',
      comment: 'King pawn',
    });
    expect(parsed.games[0].moves[1].variations).toHaveLength(1);
    expect(parsed.games[0].moves[1].variations[0][0].to).toBe('c5');
    expect(parsed.games[0].moves[1].variations[0][0].variations[0][0].to).toBe('e6');
  });

  it('preserves parser warnings without rejecting missing standard tags', () => {
    const parsed = parsePgnSource('1. e4 e5 *');
    expect(parsed.games).toHaveLength(1);
    expect(parsed.warnings.length).toBeGreaterThan(0);
    expect(parsed.warnings.every((warning) => warning.severity === 'warning')).toBe(true);
  });

  it('throws a useful error when the parser reports invalid PGN', () => {
    expect(() => parsePgnSource('1. e4 e5 2. ???')).toThrow(/PGN/i);
  });
});
