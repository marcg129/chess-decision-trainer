import { positionKeyFromFen } from './positionIdentity';

test('removes halfmove and fullmove counters from FEN', () => {
  expect(positionKeyFromFen('8/8/8/8/8/8/8/K6k w - - 17 42')).toBe(
    '8/8/8/8/8/8/8/K6k w - -',
  );
});

test('preserves an effective legal en-passant target', () => {
  expect(positionKeyFromFen('8/8/8/2pP4/8/8/8/K6k w - c6 0 1')).toBe(
    '8/8/8/2pP4/8/8/8/K6k w - c6',
  );
});

test('normalizes an ineffective en-passant target to dash', () => {
  expect(positionKeyFromFen('8/8/8/2p5/8/8/8/K6k w - c6 0 1')).toBe(
    '8/8/8/2p5/8/8/8/K6k w - -',
  );
});

test('normalizes a pseudo-available but illegal pinned en-passant capture', () => {
  expect(positionKeyFromFen('4r2k/8/8/3pP3/8/8/8/4K3 w - d6 0 1')).toBe(
    '4r2k/8/8/3pP3/8/8/8/4K3 w - -',
  );
});

test('rejects strings without the four training identity fields', () => {
  expect(() => positionKeyFromFen('not-a-fen')).toThrow(/at least four fields/i);
});
