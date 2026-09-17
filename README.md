# Chess Decision Trainer

Chess Decision Trainer is building toward a practical chess-learning app focused on faster, better decisions rather than memorizing moves without context. Phase 1 established the reliable chess/timing core. Phase 2 adds the browser-local training-data foundation that later opening drills, adaptive review, and mistake-based training will use.

## Current features

### Chess core

- Legal chess play backed by `chess.js`, including castling, en passant, checkmate/stalemate, draw handling, and explicit queen/rook/bishop/knight promotion.
- Click/tap and drag-to-move interaction through `react-chessboard`.
- A 3+2 clock driven by monotonic `performance.now()` timestamps rather than interval counts.
- Per-move decision telemetry with SAN, FEN before/after, normalized position identity, decision time, and clock state.
- Move history, undo, new game, board flip, and immediate game-over locking.
- Live FEN, normalized position key, and PGN surfaces with clipboard copy actions.
- Responsive desktop/mobile layout.

### Phase 2 local training data

- IndexedDB persistence through Dexie with versioned schema migrations.
- One local learner profile with multiple repertoires.
- A canonical position graph with legal move edges, so transpositions share the same underlying positions instead of duplicating branches.
- Repertoire-specific position/move context layered on top of the shared graph.
- Separate shared position mastery and repertoire-move mastery records.
- Durable attempt history including correctness, decision time, hints, session/context IDs, and mastery snapshots.
- Atomic graph mutations and attempt/mastery recording so failed writes roll back together.
- Versioned JSON backup export and validated replace-restore.
- Automatic pre-restore recovery backup plus explicit local-data reset.
- A narrow Training Data utility panel for inspecting counts and managing export/restore/reset operations.

All Phase 2 data is currently **browser-local**. There are no accounts, server database, or cloud synchronization yet. Clearing browser storage can remove local data, so the JSON backup feature is the portability/recovery mechanism for this phase.

## Local development

Requires a current Node.js release compatible with the lockfile. CI uses Node 22.

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
npm run test:e2e
```

`npm run test:e2e` uses Playwright against the built Vite preview and verifies that restored IndexedDB training data survives a real page reload and can be exported again through the public UI.

GitHub Actions performs a clean `npm ci`, runs the unit/integration suite, typecheck, production build, real-browser persistence smoke, and desktop/mobile browser screenshots on pull requests and supported branches.

## Scope boundary

Phase 2 intentionally stops at the training-data and persistence foundation. It does **not** yet implement the opening trainer/editor, adaptive FSRS scheduling, Stockfish analysis or bot play, generated tactical puzzles, post-game engine review, accounts, cloud sync, or sync-conflict resolution. Those later features should build on the canonical graph, repository/service boundaries, attempt history, and tested backup model already established here.
