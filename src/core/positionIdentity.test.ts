import { positionKeyFromFen } from './positionIdentity';

test('removes only halfmove and fullmove counters from FEN', () => {
  expect(positionKeyFromFen('8/8/8/8/8/8/8/K6k w - - 17 42')).toBe(
    '8/8/8/8/8/8/8/K6k w - -',
  );
  expect(positionKeyFromFen('r3k2r/8/8/3pP3/8/8/8/R3K2R w KQkq d6 0 12')).toBe(
    'r3k2r/8/8/3pP3/8/8/8/R3K2R w KQkq d6',
  );
});

test('rejects strings without the four training identity fields', () => {
  expect(() => positionKeyFromFen('not-a-fen')).toThrow(/at least four fields/i);
});
