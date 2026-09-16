# Phase 1 Chess Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a tested, responsive Vite/React chess core with legal play, 3+2 clocks, reliable move timing telemetry, PGN/FEN export, promotion handling, and transposition-aware training position identity.

**Architecture:** Keep chess rules and position identity in small domain modules backed by `chess.js`; keep timing in a dedicated React hook using `performance.now()`; let the React UI consume those interfaces without deciding move legality itself. Start from the existing Phase 1 scaffold, then harden it through tests before calling the milestone complete.

**Tech Stack:** React 19, TypeScript, Vite, `chess.js`, `react-chessboard` v5, Vitest, Testing Library, jsdom.

**Spec:** `docs/superpowers/specs/2026-09-16-phase-1-chess-core-design.md`

## Global Constraints

- Phase 1 excludes Stockfish, adaptive scheduling, cloud sync, repertoire content, and advanced coaching.
- Chess truth must remain separate from UI; `chess.js` is authoritative for legal moves and game state.
- Every accepted move must record exact decision time from a monotonic browser clock.
- Store both full FEN and a normalized training position key.
- The normalized training key uses piece placement, side to move, castling rights, and en-passant target only; halfmove/fullmove counters remain available in full FEN for rules-sensitive state.
- 3+2 clock starts only after the explicit Start action so White's first decision time is meaningful.
- Primary board interaction must support both drag and tap/click.
- PGN and FEN are the interchange formats.
- Production promotion interaction must offer queen, rook, bishop, or knight; never silently force queen promotion.
- The UI must remain usable without horizontal page scrolling at approximately 320px width.
- No Chess.com proprietary assets, branding, sounds, or copied written content.

## File Structure

- `package.json` — runtime/test scripts and dependencies.
- `vite.config.ts` — Vite + Vitest/jsdom configuration.
- `src/core/positionIdentity.ts` — normalized training-position key.
- `src/core/game.ts` — `ChessGame` domain wrapper and snapshot/status API.
- `src/core/trainingTypes.ts` — move telemetry record type.
- `src/core/moveTelemetry.ts` — deterministic move-record construction.
- `src/hooks/useChessClock.ts` — 3+2 clock and monotonic timing.
- `src/components/ChessClock.tsx` — presentational clock.
- `src/components/MoveList.tsx` — presentational move/think-time log.
- `src/components/PromotionPicker.tsx` — accessible promotion chooser.
- `src/App.tsx` — UI orchestration only.
- `src/styles.css` — responsive layout/touch sizing.
- `src/test/setup.ts` — Testing Library setup.
- Unit/integration tests beside the modules they cover.

---

### Task 1: Establish the runnable app and test harness

**Files:** Create `package.json`, `vite.config.ts`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `index.html`, `.gitignore`, `src/main.tsx`, `src/styles.css`, `src/test/setup.ts`, `src/App.tsx`, `src/App.smoke.test.tsx`.

**Interfaces:** Produces `npm test`, `npm run typecheck`, `npm run build`, and the Vite entrypoint.

- [ ] **Step 1: Write the failing smoke test**

```tsx
import { render, screen } from '@testing-library/react';
import App from './App';

test('renders the chess core heading', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: /chess decision trainer/i })).toBeInTheDocument();
});
```

`src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 2: Configure package scripts and test environment**

`package.json` must expose:

```json
{
  "scripts": {
    "dev": "vite",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -b --pretty false",
    "build": "tsc -b && vite build"
  }
}
```

Runtime dependencies: `chess.js`, `react`, `react-chessboard`, `react-dom`. Dev dependencies: `@testing-library/jest-dom`, `@testing-library/react`, `@testing-library/user-event`, `@types/node`, `@types/react`, `@types/react-dom`, `@vitejs/plugin-react`, `jsdom`, `typescript`, `vite`, `vitest`.

`vite.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', setupFiles: ['./src/test/setup.ts'] },
});
```

- [ ] **Step 3: Run the smoke test and verify failure**

Run: `npm install && npm test -- src/App.smoke.test.tsx`

Expected: FAIL until `App` exists with the expected heading.

- [ ] **Step 4: Add the minimum app shell**

```tsx
export default function App() {
  return <h1>Chess Decision Trainer</h1>;
}
```

`src/main.tsx` mounts `<App />` through `createRoot` and imports `styles.css`.

- [ ] **Step 5: Verify harness**

Run:

```bash
npm test -- src/App.smoke.test.tsx
npm run typecheck
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vite.config.ts tsconfig*.json index.html .gitignore src/
git commit -m "chore: scaffold phase 1 chess app"
```

---

### Task 2: Implement chess domain state and training position identity

**Files:** Create `src/core/positionIdentity.ts`, `src/core/positionIdentity.test.ts`, `src/core/game.ts`, `src/core/game.test.ts`.

**Interfaces:**

```ts
export function positionKeyFromFen(fen: string): string;

export type GameStatus =
  | 'playing'
  | 'checkmate'
  | 'stalemate'
  | 'draw'
  | 'insufficient-material'
  | 'threefold-repetition';

export type GameSnapshot = {
  fen: string;
  pgn: string;
  positionKey: string;
  turn: Color;
  history: Move[];
  status: GameStatus;
  inCheck: boolean;
};

export class ChessGame {
  constructor(fen?: string);
  snapshot(): GameSnapshot;
  move(from: Square, to: Square, promotion?: 'q' | 'r' | 'b' | 'n'): Move | null;
  undo(): Move | null;
  reset(): void;
  loadFen(fen: string): void;
  loadPgn(pgn: string): void;
  legalMoves(square: Square): Move[];
  pieceAt(square: Square): ReturnType<Chess['get']>;
  requiresPromotion(from: Square, to: Square): boolean;
}
```

- [ ] **Step 1: Write failing identity tests**

```ts
expect(positionKeyFromFen('8/8/8/8/8/8/8/K6k w - - 17 42'))
  .toBe('8/8/8/8/8/8/8/K6k w - -');
expect(positionKeyFromFen('r3k2r/8/8/3pP3/8/8/8/R3K2R w KQkq d6 0 12'))
  .toBe('r3k2r/8/8/3pP3/8/8/8/R3K2R w KQkq d6');
expect(() => positionKeyFromFen('not-a-fen')).toThrow(/at least four fields/i);
```

- [ ] **Step 2: Run identity tests and confirm failure**

Run: `npm test -- src/core/positionIdentity.test.ts`

- [ ] **Step 3: Implement the identity helper**

```ts
export function positionKeyFromFen(fen: string): string {
  const fields = fen.trim().split(/\s+/);
  if (fields.length < 4) throw new Error('Invalid FEN: expected at least four fields.');
  return fields.slice(0, 4).join(' ');
}
```

- [ ] **Step 4: Write failing `ChessGame` tests**

Required fixtures/assertions:

```ts
const game = new ChessGame();
expect(game.move('e2', 'e4')?.san).toBe('e4');
expect(game.move('e2', 'e5')).toBeNull();
```

```ts
const castle = new ChessGame('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
expect(castle.move('e1', 'g1')?.san).toContain('O-O');
```

```ts
const ep = new ChessGame('8/8/8/3pP3/8/8/8/K6k w - d6 0 1');
expect(ep.move('e5', 'd6')?.flags).toContain('e');
```

Promotion: instantiate `new ChessGame('7k/P7/8/8/8/8/8/K7 w - - 0 1')` separately for `q`, `r`, `b`, `n`, move `a7-a8`, and assert `pieceAt('a8')?.type` equals the chosen type.

Checkmate: Fool's Mate `f3 e5 g4 Qh4#` → `checkmate`.

Stalemate: `7k/5Q2/6K1/8/8/8/8/8 b - - 0 1` → `stalemate`.

Insufficient material: `8/8/8/8/8/8/8/K6k w - - 0 1` → `insufficient-material`.

50-move draw: `8/8/8/8/8/8/7R/K6k w - - 100 75` → `draw`.

Threefold: play `Nf3 Nf6 Ng1 Ng8 Nf3 Nf6 Ng1 Ng8` → `threefold-repetition`.

Transposition identity: compare position keys after `Nf3 Nf6 g3 g6` and `g3 g6 Nf3 Nf6`; they must match.

- [ ] **Step 5: Run domain tests and confirm failure**

Run: `npm test -- src/core/positionIdentity.test.ts src/core/game.test.ts`

- [ ] **Step 6: Implement `ChessGame` minimally**

Use one private `Chess` instance. `snapshot()` derives current FEN, PGN, normalized key, turn, verbose history, check state, and status. Status precedence: checkmate → stalemate → insufficient material → threefold repetition → generic draw → playing. `move()` catches invalid move errors and returns `null`. `requiresPromotion()` checks a pawn moving to rank 8/1.

- [ ] **Step 7: Verify domain tests**

Run: `npm test -- src/core/positionIdentity.test.ts src/core/game.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/core/
git commit -m "feat: add tested chess domain core"
```

---

### Task 3: Implement move telemetry and deterministic 3+2 clock

**Files:** Create `src/core/trainingTypes.ts`, `src/core/moveTelemetry.ts`, `src/core/moveTelemetry.test.ts`, `src/hooks/useChessClock.ts`, `src/hooks/useChessClock.test.tsx`.

**Interfaces:**

```ts
export type MoveDecisionRecord = {
  ply: number;
  mover: Color;
  san: string;
  lan: string;
  from: string;
  to: string;
  promotion?: string;
  fenBefore: string;
  positionKeyBefore: string;
  fenAfter: string;
  positionKeyAfter: string;
  decisionTimeMs: number | null;
  clockAfterMs: number | null;
};
```

```ts
export function createMoveDecisionRecord(input: {
  ply: number;
  move: Move;
  before: GameSnapshot;
  after: GameSnapshot;
  timing: { decisionTimeMs: number | null; clockAfterMs: number | null };
}): MoveDecisionRecord;
```

`useChessClock(config)` returns `whiteMs`, `blackMs`, `active`, `running`, `flagged`, `start`, `pause`, `commitMove`, `reset`.

- [ ] **Step 1: Write failing telemetry test**

```ts
const game = new ChessGame();
const before = game.snapshot();
const move = game.move('e2', 'e4')!;
const after = game.snapshot();
const record = createMoveDecisionRecord({
  ply: 1,
  move,
  before,
  after,
  timing: { decisionTimeMs: 1200, clockAfterMs: 180800 },
});
expect(record).toMatchObject({
  ply: 1,
  mover: 'w',
  san: 'e4',
  from: 'e2',
  to: 'e4',
  fenBefore: before.fen,
  fenAfter: after.fen,
  positionKeyBefore: before.positionKey,
  positionKeyAfter: after.positionKey,
  decisionTimeMs: 1200,
  clockAfterMs: 180800,
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- src/core/moveTelemetry.test.ts`

- [ ] **Step 3: Implement `createMoveDecisionRecord`**

Map the `Move`, before/after snapshots, timing, and supplied ply directly into `MoveDecisionRecord`; no chess logic belongs here.

- [ ] **Step 4: Write failing hook tests with fake timers and mocked `performance.now()`**

Core setup:

```tsx
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
```

Required assertions:

```tsx
const { result } = renderHook(() => useChessClock(CONFIG));
expect(result.current.whiteMs).toBe(180_000);
expect(result.current.blackMs).toBe(180_000);
expect(result.current.active).toBe('w');
expect(result.current.running).toBe(false);
```

After `start('w')`, set `nowMs = 5000`, advance interval by 100ms, and assert White ≈175000, Black 180000.

Then verify:

```tsx
let timing!:{ decisionTimeMs:number|null; clockAfterMs:number|null };
act(() => { timing = result.current.commitMove('w', 'b'); });
expect(timing).toEqual({ decisionTimeMs: 5000, clockAfterMs: 177000 });
expect(result.current.active).toBe('b');
```

Also assert a non-active mover returns `{ decisionTimeMs: null, clockAfterMs: null }`, reaching zero flags the active color and stops the clock, and `reset('w')` restores 180000/180000 with no flag.

- [ ] **Step 5: Run hook tests and confirm failure**

Run: `npm test -- src/hooks/useChessClock.test.tsx`

- [ ] **Step 6: Implement the hook**

Rules:

```ts
const now = () => performance.now();
```

`turnStartedAtRef` is the source of truth for decision duration. `commitMove` computes elapsed before mutating React state. Increment applies only when time remains after thinking. `pause` materializes elapsed time. A 100ms interval may refresh display, but interval count never determines chess time. Every interval is cleaned up on effect teardown.

- [ ] **Step 7: Verify telemetry + clock**

Run:

```bash
npm test -- src/core/moveTelemetry.test.ts src/hooks/useChessClock.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/core/trainingTypes.ts src/core/moveTelemetry.ts src/core/moveTelemetry.test.ts src/hooks/
git commit -m "feat: add tested 3+2 timing telemetry"
```

---

### Task 4: Integrate board interaction, promotion, status, and decision log

**Files:** Modify `src/App.tsx`; create `src/components/ChessClock.tsx`, `src/components/MoveList.tsx`, `src/components/PromotionPicker.tsx`, `src/App.test.tsx`.

**Interfaces:** `App` accepts `type AppProps = { initialFen?: string }` solely as a deterministic test/development seam; production use omits it.

- [ ] **Step 1: Mock only the third-party board surface in `App.test.tsx`**

```tsx
vi.mock('react-chessboard', () => ({
  Chessboard: ({ options }: { options: any }) => (
    <div data-testid="board" data-orientation={options.boardOrientation}>
      <button onClick={() => options.onSquareClick?.({ square: 'e2', piece: { pieceType: 'wP' } })}>click e2</button>
      <button onClick={() => options.onSquareClick?.({ square: 'e4', piece: null })}>click e4</button>
      <button onClick={() => options.onSquareClick?.({ square: 'a7', piece: { pieceType: 'wP' } })}>click a7</button>
      <button onClick={() => options.onSquareClick?.({ square: 'a8', piece: null })}>click a8</button>
      <button onClick={() => options.onPieceDrop?.({ sourceSquare: 'e2', targetSquare: 'e4', piece: { pieceType: 'wP' } })}>drag e2-e4</button>
    </div>
  ),
}));
```

- [ ] **Step 2: Write failing UI behavior tests**

Test exact behaviors:

```tsx
render(<App />);
await user.click(screen.getByRole('button', { name: 'click e2' }));
await user.click(screen.getByRole('button', { name: 'click e4' }));
expect(screen.queryByText(/^e4$/)).not.toBeInTheDocument(); // clock not started
```

Then start the clock and verify click-to-move shows `e4`. In a separate fresh render, start clock and use `drag e2-e4`; verify `e4` appears.

Flip test: initial board has `data-orientation="white"`; pressing Flip board changes it to `black` without changing the game state.

Promotion test:

```tsx
render(<App initialFen="7k/P7/8/8/8/8/8/K7 w - - 0 1" />);
// start clock, click a7, click a8
expect(screen.getByRole('dialog', { name: /choose promotion piece/i })).toBeInTheDocument();
await user.click(screen.getByRole('button', { name: 'Knight' }));
expect(screen.getByText(/a8=N/)).toBeInTheDocument();
```

Completed-game test:

```tsx
render(<App initialFen="7k/6Q1/6K1/8/8/8/8/8 b - - 0 1" />);
expect(screen.getByText(/checkmate/i)).toBeInTheDocument();
expect(screen.queryByRole('button', { name: /start|resume/i })).not.toBeInTheDocument();
```

- [ ] **Step 3: Run tests and confirm failure**

Run: `npm test -- src/App.test.tsx`

- [ ] **Step 4: Implement the presentational components**

`ChessClock` props:

```ts
type Props = {
  color: Color;
  label: string;
  milliseconds: number;
  active: boolean;
  running: boolean;
  flagged: boolean;
};
```

`PromotionPicker` props:

```ts
type Promotion = 'q' | 'r' | 'b' | 'n';
type Props = { onChoose: (promotion: Promotion) => void; onCancel: () => void };
```

Promotion chooser uses `role="dialog"`, `aria-modal="true"`, an accessible name `Choose promotion piece`, and native Queen/Rook/Bishop/Knight buttons.

`MoveList` receives `records: MoveDecisionRecord[]`, groups by move number, and displays SAN plus formatted think time.

- [ ] **Step 5: Implement `App` orchestration**

Rules:

- Create one `ChessGame(initialFen)` instance in a ref.
- `snapshot` mirrors `game.snapshot()` for rendering.
- `applyMove` returns `false` unless `clock.running` and the game is not over. This guarantees every accepted Phase 1 move has timing telemetry.
- `applyMove` captures `before`, attempts the domain move, gets `after`, calls `clock.commitMove`, and appends `createMoveDecisionRecord(...)` using functional `setRecords` so `ply` cannot use stale state.
- Drag and click/tap both call one `requestMove` path.
- If `requiresPromotion(from,to)` is true, open the chooser and keep the clock running until a promotion choice is committed.
- Legal target markers come from `game.legalMoves(selectedSquare)`.
- `gameOver = snapshot.status !== 'playing' || Boolean(clock.flagged)` prevents later moves and clocks.
- Flip changes only board orientation.
- New game resets game, records, selection, pending promotion, and clock.
- Undo pauses the clock and removes the latest record; do not invent reconstructed clock timing.

Use current `react-chessboard` v5 shape:

```tsx
<Chessboard options={{
  id: 'decision-trainer-board',
  position: snapshot.fen,
  boardOrientation: orientation,
  onPieceDrop,
  onSquareClick,
  squareStyles: legalTargetStyles,
}} />
```

- [ ] **Step 6: Verify all tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/App.test.tsx src/components/
git commit -m "feat: integrate playable chess core ui"
```

---

### Task 5: Add FEN/PGN interoperability and responsive production styling

**Files:** Modify `src/App.tsx`, `src/App.test.tsx`, `src/styles.css`; create/update `README.md`.

- [ ] **Step 1: Write failing export tests**

```tsx
test('shows FEN, normalized position key, and PGN', () => {
  render(<App />);
  expect(screen.getByLabelText('FEN')).toHaveValue(expect.stringContaining(' w '));
  expect(screen.getByLabelText('Position key')).toHaveValue(expect.any(String));
  expect(screen.getByLabelText('PGN')).toBeInTheDocument();
});
```

Clipboard test: mock `navigator.clipboard.writeText`; start clock, play `e4`, read the visible FEN/PGN textareas, click Copy FEN/Copy PGN, and assert the exact textarea values were passed to `writeText`. A rejected clipboard promise must render `role="status"` containing `Clipboard unavailable`.

- [ ] **Step 2: Run targeted tests and confirm failure**

Run: `npm test -- src/App.test.tsx`

- [ ] **Step 3: Implement interoperability panel**

Render read-only, visibly labeled textareas for `FEN`, `Position key`, and `PGN`, plus Copy FEN and Copy PGN buttons. Empty PGN displays `No moves yet.` but Copy PGN stays disabled until real PGN exists.

- [ ] **Step 4: Implement responsive CSS**

Required layout behavior:

- Desktop: board dominant; side panel beside board when width permits.
- Board wrapper never exceeds available width (`width: min(100%, 720px)` or equivalent).
- Tablet/mobile: side panel reflows below board.
- At ~320px, layout containers/form controls use `min-width: 0`; no page-level horizontal overflow.
- Primary buttons are at least ~44px tall/tappable.
- Promotion chooser remains usable on touch.
- Clocks remain readable above/below the board.

- [ ] **Step 5: Document workflow in README**

Include:

```bash
npm install
npm run dev
npm test
npm run typecheck
npm run build
```

State clearly that Phase 1 includes legal chess, 3+2 timing telemetry, FEN/PGN, and responsive board interaction, but excludes Stockfish and training modes.

- [ ] **Step 6: Run full automated verification**

```bash
npm test
npm run typecheck
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/App.test.tsx src/styles.css README.md
git commit -m "feat: finish responsive phase 1 chess core"
```

---

### Task 6: Final Phase 1 verification and PR handoff

**Files:** Modify only if verification finds a defect.

- [ ] **Step 1: Clean-install automated verification**

```bash
rm -rf node_modules dist
npm ci
npm test
npm run typecheck
npm run build
```

Expected: every command succeeds with zero failing tests/type errors/build errors.

- [ ] **Step 2: Desktop smoke test**

Run `npm run dev -- --host 0.0.0.0` and verify: Start → first move → opponent move records plausible decision times; drag and click/tap both work; castling/en-passant are accepted in legal positions; promotion chooser offers all four pieces; checkmate/draw freezes interaction and clock; Flip preserves game state; FEN/PGN update after every legal move.

- [ ] **Step 3: Narrow-width smoke test**

At approximately 320px CSS width verify no page-level horizontal scrolling; board remains fully visible; clocks readable; controls tappable; history and position data reflow below board.

- [ ] **Step 4: Inspect telemetry invariants for at least four plies**

Each `MoveDecisionRecord` must have incrementing `ply`, correct mover/SAN/from/to, non-empty before/after FEN and position keys, non-negative decision time after Start, and clock-after value reflecting the 2-second increment.

- [ ] **Step 5: Commit only real verification fixes**

```bash
git add <only files actually fixed>
git commit -m "fix: resolve phase 1 verification issues"
```

If no fixes are needed, do not create an empty commit.

- [ ] **Step 6: Record evidence in the PR description**

List exact automated commands and desktop/~320px smoke results. Do not mark Phase 1 complete until all acceptance criteria in the spec are satisfied.
