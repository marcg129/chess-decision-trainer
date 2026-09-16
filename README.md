# Chess Decision Trainer

Phase 1 establishes the reliable chess core for a later decision-training application. The current build is intentionally focused on correct play, accurate 3+2 timing, and deterministic move telemetry rather than opening lessons, engine opponents, or analysis features.

## Phase 1 features

- Legal chess play backed by `chess.js`, including castling, en passant, checkmate/stalemate, draw handling, and explicit queen/rook/bishop/knight promotion.
- Click/tap and drag-to-move interaction through `react-chessboard`.
- A 3+2 clock driven by monotonic `performance.now()` timestamps rather than interval counts.
- Per-move decision telemetry with SAN, FEN before/after, normalized position identity, decision time, and clock state.
- Move history, undo, new game, board flip, and immediate game-over locking.
- Live FEN, normalized position key, and PGN surfaces with clipboard copy actions.
- Responsive desktop/mobile layout.

## Local development

Requires a current Node.js release compatible with the lockfile (CI uses Node 22).

```bash
npm ci
npm run dev
```

Then open the local Vite URL shown in the terminal.

## Verification

```bash
npm test
npm run typecheck
npm run build
```

The GitHub Actions workflow runs the same clean-install verification sequence on pull requests.

## Scope boundary

This phase does **not** yet add an engine/bot, opening curriculum, generated tactical puzzles, post-game engine analysis, accounts, persistence, or cloud sync. Those features should build on this tested chess/timing/telemetry layer instead of bypassing it.
