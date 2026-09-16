import { useCallback, useEffect, useRef, useState } from 'react';
import type { Color } from 'chess.js';

export type ChessClockConfig = {
  initialMs: number;
  incrementMs: number;
};

export type MoveTiming = {
  decisionTimeMs: number | null;
  clockAfterMs: number | null;
};

export function useChessClock({ initialMs, incrementMs }: ChessClockConfig) {
  const whiteBaseRef = useRef(initialMs);
  const blackBaseRef = useRef(initialMs);
  const activeRef = useRef<Color>('w');
  const runningRef = useRef(false);
  const flaggedRef = useRef<Color | null>(null);
  const turnStartedAtRef = useRef<number | null>(null);

  const [whiteMs, setWhiteMs] = useState(initialMs);
  const [blackMs, setBlackMs] = useState(initialMs);
  const [active, setActive] = useState<Color>('w');
  const [running, setRunning] = useState(false);
  const [flagged, setFlagged] = useState<Color | null>(null);

  const setClock = useCallback((color: Color, value: number) => {
    if (color === 'w') {
      whiteBaseRef.current = value;
      setWhiteMs(value);
    } else {
      blackBaseRef.current = value;
      setBlackMs(value);
    }
  }, []);

  const remainingAt = useCallback((color: Color, timestamp: number) => {
    const base = color === 'w' ? whiteBaseRef.current : blackBaseRef.current;
    if (
      !runningRef.current ||
      activeRef.current !== color ||
      turnStartedAtRef.current === null
    ) {
      return base;
    }
    return Math.max(0, base - (timestamp - turnStartedAtRef.current));
  }, []);

  const stopOnFlag = useCallback((color: Color) => {
    flaggedRef.current = color;
    setFlagged(color);
    runningRef.current = false;
    setRunning(false);
    turnStartedAtRef.current = null;
  }, []);

  const refresh = useCallback(() => {
    if (!runningRef.current || turnStartedAtRef.current === null) return;
    const color = activeRef.current;
    const remaining = remainingAt(color, performance.now());
    if (color === 'w') setWhiteMs(remaining);
    else setBlackMs(remaining);

    if (remaining <= 0) {
      if (color === 'w') whiteBaseRef.current = 0;
      else blackBaseRef.current = 0;
      stopOnFlag(color);
    }
  }, [remainingAt, stopOnFlag]);

  useEffect(() => {
    if (!running) return undefined;
    const id = window.setInterval(refresh, 100);
    return () => window.clearInterval(id);
  }, [refresh, running]);

  const start = useCallback((color: Color = activeRef.current) => {
    if (runningRef.current || flaggedRef.current) return;
    activeRef.current = color;
    setActive(color);
    runningRef.current = true;
    setRunning(true);
    turnStartedAtRef.current = performance.now();
  }, []);

  const pause = useCallback(() => {
    if (!runningRef.current || turnStartedAtRef.current === null) return;
    const color = activeRef.current;
    const remaining = remainingAt(color, performance.now());
    setClock(color, remaining);
    if (remaining <= 0) {
      stopOnFlag(color);
      return;
    }
    runningRef.current = false;
    setRunning(false);
    turnStartedAtRef.current = null;
  }, [remainingAt, setClock, stopOnFlag]);

  const commitMove = useCallback(
    (mover: Color, next: Color): MoveTiming => {
      if (
        !runningRef.current ||
        flaggedRef.current ||
        activeRef.current !== mover ||
        turnStartedAtRef.current === null
      ) {
        return { decisionTimeMs: null, clockAfterMs: null };
      }

      const timestamp = performance.now();
      const decisionTimeMs = Math.max(0, timestamp - turnStartedAtRef.current);
      const remaining = remainingAt(mover, timestamp);

      if (remaining <= 0) {
        setClock(mover, 0);
        stopOnFlag(mover);
        return { decisionTimeMs, clockAfterMs: 0 };
      }

      const clockAfterMs = remaining + incrementMs;
      setClock(mover, clockAfterMs);
      activeRef.current = next;
      setActive(next);
      turnStartedAtRef.current = timestamp;
      return { decisionTimeMs, clockAfterMs };
    },
    [incrementMs, remainingAt, setClock, stopOnFlag],
  );

  const reset = useCallback(
    (color: Color = 'w') => {
      whiteBaseRef.current = initialMs;
      blackBaseRef.current = initialMs;
      activeRef.current = color;
      runningRef.current = false;
      flaggedRef.current = null;
      turnStartedAtRef.current = null;
      setWhiteMs(initialMs);
      setBlackMs(initialMs);
      setActive(color);
      setRunning(false);
      setFlagged(null);
    },
    [initialMs],
  );

  return {
    whiteMs,
    blackMs,
    active,
    running,
    flagged,
    start,
    pause,
    commitMove,
    reset,
  };
}
