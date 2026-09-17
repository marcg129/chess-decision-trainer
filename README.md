# Chess Decision Trainer

Chess Decision Trainer is a practical chess-learning app focused on faster, better decisions rather than memorizing moves without context. Phase 1 established the reliable chess/timing core, Phase 2 added the browser-local training-data foundation, and Phase 3 adds the first complete opening-training workflow on top of that foundation.

## Current features

### Phase 3 opening training

- `Train | Play | Data` top-level navigation, with Train as the default surface.
- A built-in demo repertoire that uses the same import, graph, persistence, and training paths as user-created repertoires.
- Multi-game PGN import with game selection, White/Black repertoire choice, repertoire naming, preview counts, validation warnings, nested variations, and PGN comments/explanations.
- Atomic repertoire creation: preview never writes data, and confirmation creates the repertoire through one bulk persistence operation.
- Canonical position-graph imports, so transpositions converge on shared positions instead of duplicating branches.
- Practice Line sessions that start from the repertoire root and automatically choose imported opponent responses while rotating toward less-practiced branches.
- Quick Recall sessions that favor unseen, incorrect, hinted, and slow positions without introducing date-based spaced-repetition scheduling yet.
- One preferred learner move plus accepted imported alternatives. Accepted alternatives remain correct while still showing the preferred move.
- Guided correction: the first wrong legal move prompts another look; repeated misses reveal the preferred move, but the learner still has to play it before continuing.
- Progressive hints and imported explanations that stay hidden until requested or until feedback is shown.
- A soft 5-second decision target. Decision time is always recorded, but a slow correct move remains correct.
- Durable training attempts, session history, mastery updates, and retry-safe persistence if an attempt write fails.
- Responsive opening-training, import, and trainer layouts verified at a 320px viewport.

### Chess core / Play

- Legal chess play backed by `chess.js`, including castling, en passant, checkmate/stalemate, draw handling, and explicit queen/rook/bishop/knight promotion.
- Click/tap and drag-to-move interaction through `react-chessboard`.
- A 3+2 clock driven by monotonic `performance.now()` timestamps rather than interval counts.
- Per-move decision telemetry with SAN, FEN before/after, normalized position identity, decision time, and clock state.
- Move history, undo, new game, board flip, and immediate game-over locking.
- Live FEN, normalized position key, and PGN surfaces with clipboard copy actions.
- Responsive desktop/mobile layout.

### Browser-local training data / Data

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

All training data is currently **browser-local**. There are no accounts, server database, or cloud synchronization yet. Clearing browser storage can remove local data, so the JSON backup feature is the portability/recovery mechanism for this phase.

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

`npm run test:e2e` uses Playwright against the built Vite preview. The browser suite verifies browser-local restore/reload/export behavior plus the Phase 3 public workflow: multi-game PGN import, repertoire persistence across reloads, a real Practice Line move and durable attempt, Quick Recall startup, and 320px no-horizontal-overflow checks.

GitHub Actions performs a clean `npm ci`, runs the unit/integration suite, typecheck, production build, real-browser E2E coverage, and desktop/mobile browser screenshots on pull requests and supported branches.

## Scope boundary

Phase 3 intentionally stops at the opening-training MVP. It does **not** yet implement Stockfish analysis or bot play, FSRS/date-based adaptive scheduling, a full visual repertoire editor, cloud accounts/synchronization, generated tactical puzzles, middlegame/endgame training, a mistake bank, or post-game engine review. Those later features should build on the canonical graph, repository/service boundaries, attempt history, and tested browser-local persistence already established here.
