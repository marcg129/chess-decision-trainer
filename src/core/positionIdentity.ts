export function positionKeyFromFen(fen: string): string {
  const fields = fen.trim().split(/\s+/);
  if (fields.length < 4) {
    throw new Error('Invalid FEN: expected at least four fields.');
  }
  return fields.slice(0, 4).join(' ');
}
