import { Chess } from 'chess.js';

export function positionKeyFromFen(fen: string): string {
  const fields = fen.trim().split(/\s+/);
  if (fields.length < 4) {
    throw new Error('Invalid FEN: expected at least four fields.');
  }

  const [placement, turn, castling, enPassant] = fields;
  const chess = new Chess(fen);
  const effectiveEnPassant =
    enPassant !== '-' &&
    chess.moves({ verbose: true }).some(
      (move) => move.flags.includes('e') && move.to === enPassant,
    )
      ? enPassant
      : '-';

  return `${placement} ${turn} ${castling} ${effectiveEnPassant}`;
}
