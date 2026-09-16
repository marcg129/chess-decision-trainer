import { act, renderHook } from '@testing-library/react';
import { useChessClock } from './useChessClock';

const CONFIG = { initialMs: 180_000, incrementMs: 2_000 };
let nowMs = 0;

beforeEach(() => {
  vi.useFakeTimers();
  nowMs = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test('starts stopped at 3+2 with White active', () => {
  const { result } = renderHook(() => useChessClock(CONFIG));
  expect(result.current.whiteMs).toBe(180_000);
  expect(result.current.blackMs).toBe(180_000);
  expect(result.current.active).toBe('w');
  expect(result.current.running).toBe(false);
  expect(result.current.flagged).toBeNull();
});

test('uses monotonic elapsed time and applies increment only after a valid commit', () => {
  const { result } = renderHook(() => useChessClock(CONFIG));

  act(() => result.current.start('w'));
  act(() => {
    nowMs = 5000;
    vi.advanceTimersByTime(100);
  });
  expect(result.current.whiteMs).toBe(175_000);
  expect(result.current.blackMs).toBe(180_000);

  let timing!: { decisionTimeMs: number | null; clockAfterMs: number | null };
  act(() => {
    timing = result.current.commitMove('w', 'b');
  });
  expect(timing).toEqual({ decisionTimeMs: 5000, clockAfterMs: 177000 });
  expect(result.current.whiteMs).toBe(177_000);
  expect(result.current.active).toBe('b');
  expect(result.current.running).toBe(true);
});

test('does not mutate the clock for a non-active mover', () => {
  const { result } = renderHook(() => useChessClock(CONFIG));
  act(() => result.current.start('w'));
  nowMs = 2000;

  let timing!: { decisionTimeMs: number | null; clockAfterMs: number | null };
  act(() => {
    timing = result.current.commitMove('b', 'w');
  });

  expect(timing).toEqual({ decisionTimeMs: null, clockAfterMs: null });
  expect(result.current.active).toBe('w');
});

test('flags the active player at zero and stops', () => {
  const { result } = renderHook(() => useChessClock(CONFIG));
  act(() => result.current.start('w'));
  act(() => {
    nowMs = 180_001;
    vi.advanceTimersByTime(100);
  });

  expect(result.current.whiteMs).toBe(0);
  expect(result.current.flagged).toBe('w');
  expect(result.current.running).toBe(false);
});

test('pause materializes elapsed time and reset restores a clean clock', () => {
  const { result } = renderHook(() => useChessClock(CONFIG));
  act(() => result.current.start('w'));
  act(() => {
    nowMs = 3250;
    result.current.pause();
  });
  expect(result.current.whiteMs).toBe(176_750);
  expect(result.current.running).toBe(false);

  act(() => result.current.reset('w'));
  expect(result.current.whiteMs).toBe(180_000);
  expect(result.current.blackMs).toBe(180_000);
  expect(result.current.active).toBe('w');
  expect(result.current.flagged).toBeNull();
  expect(result.current.running).toBe(false);
});
