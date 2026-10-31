# Chess Decision Trainer

Chess Decision Trainer is a practical chess-learning app focused on faster, better decisions rather than memorizing moves without context. Phase 1 established the chess/timing core, Phase 2 added browser-local training data, Phase 3 delivered opening practice, and Phase 4 adds adaptive spaced repetition through Review Due.

## Current features

### Phase 4 adaptive review

- A dedicated **Review Due** mode alongside Practice Line and Quick Recall.
- One global due queue across all active repertoires, with an optional repertoire filter for focused review.
- Due/overdue cards are served before new material. Large backlogs remain genuinely due but are presented in manageable batches.
- New material is balanced across active repertoires instead of allowing one large repertoire to consume the daily allowance.
- Configurable review settings stored with the local learner:
  - **10 new cards/day** by default.
  - **15 unique cards/batch** by default.
  - New-card range: 0–100/day.
  - Batch-size range: 1–100.
- One spaced-repetition card per trainable repertoire position, tied to that position's preferred repertoire move.
- FSRS scheduling through ts-fsrs, isolated behind the app's own scheduling adapter and versioned JSON-safe scheduling envelope.
- Fully automatic **Again / Hard / Good / Easy** grading. There is no self-rating screen.
- Grading considers correctness, preferred-vs-alternative recall, hints, the 5-second practical target, historical decision speed, and prior scheduled-review history.
- Accepted alternatives remain correct chess responses but grade **Hard** because the scheduled memory target is the preferred repertoire move.
- A failed scheduled recall grades **Again**, receives guided correction, and returns for same-session relearning only after both at least 3 intervening prompts and at least 2 minutes.
- Successful relearning is stored as training history but does **not** advance FSRS again; the original failed scheduled recall remains the long-term scheduling signal.
- Only Review Due changes the spaced-repetition schedule. Practice Line and Quick Recall still update attempt history, descriptive mastery, decision speed, hints, and weakness data without pushing the next FSRS review into the future.
- Mixed White/Black global review sessions automatically switch board orientation and repertoire context from card to card.
- Review sessions support click/tap, drag-to-move, explicit promotion choice, hints, guided correction, persistence retry, completion summaries, and Continue Reviewing.
- Review settings, FSRS state, due dates, and review-attempt metadata are browser-local and survive reloads.

### Phase 3 opening training

- Train | Play | Data top-level navigation, with Train as the default surface.
- A built-in demo repertoire that uses the same import, graph, persistence, and training paths as user-created repertoires.
- Multi-game PGN import with game selection, White/Black repertoire choice, repertoire naming, preview counts, validation warnings, nested variations, and PGN comments/explanations.
- Atomic repertoire creation: preview never writes data, and confirmation creates the repertoire through one bulk persistence operation.
- Canonical position-graph imports, so transpositions converge on shared positions instead of duplicating branches.
- Practice Line sessions that start from the repertoire root and automatically choose imported opponent responses while rotating toward less-practiced branches.
- Quick Recall sessions that favor unseen, incorrect, hinted, and slow positions for unscheduled weakness drilling.
- One preferred learner move plus accepted imported alternatives.
- Guided correction: the first wrong legal move prompts another look; repeated misses reveal the preferred move, but the learner still has to play it before continuing.
- Progressive hints and imported explanations that stay hidden until requested or feedback is shown.
- A soft 5-second decision target. Decision time is always recorded, but a slow correct move remains correct.
- Durable training attempts, session history, mastery updates, and retry-safe persistence if an attempt write fails.
- Responsive opening-training, import, and trainer layouts verified at a 320px viewport.

### Chess core / Play

- Legal chess play backed by chess.js, including castling, en passant, checkmate/stalemate, draw handling, and explicit queen/rook/bishop/knight promotion.
- Click/tap and drag-to-move interaction through react-chessboard.
- A 3+2 clock driven by monotonic performance.now() timestamps rather than interval counts.
- Per-move decision telemetry with SAN, FEN before/after, normalized position identity, decision time, and clock state.
- Move history, undo, new game, board flip, and immediate game-over locking.
- Live FEN, normalized position key, and PGN surfaces with clipboard copy actions.
- Responsive desktop/mobile layout.

### Browser-local training data / Data

- IndexedDB persistence through Dexie with versioned schema migrations.
- One local learner profile with multiple repertoires. Concurrent startup initialization is serialized so Train, Review Due, and Data cannot create duplicate local learners.
- A canonical position graph with legal move edges, so transpositions share the same underlying positions instead of duplicating branches.
- Repertoire-specific position/move context layered on top of the shared graph.
- Separate shared position mastery and repertoire-move mastery records.
- Durable attempt history including correctness, decision time, hints, session/context IDs, mastery snapshots, and Phase 4 review metadata.
- Atomic graph mutations, normal attempt/mastery writes, and scheduled-review persistence.
- Retry-safe scheduled review writes so the same stable attempt cannot advance an FSRS card twice.
- Indexed due-date lookup for repertoire-move mastery.
- **Backup V2** for new exports, including Phase 4 review settings and scheduling metadata.
- Full restore support for both **V1 and V2** backups.
- Validated replace-restore, automatic pre-restore recovery backup, and explicit local-data reset.
- A Training Data utility panel for inspecting counts and managing export/restore/reset operations.

All training and scheduling data is currently **browser-local**. There are no accounts, server database, or cloud synchronization yet. Clearing browser storage can remove local data, so JSON backup export is the portability/recovery mechanism for this phase.

## Local development

Requires a current Node.js release compatible with the lockfile. CI uses Node 22.

~~~bash
npm ci
npm run dev
~~~

Then open the local Vite URL shown in the terminal.

## Verification

~~~bash
npm test
npm run typecheck
npm run build
npm run test:e2e
~~~

The Playwright suite exercises browser-local persistence and the public training workflow, including PGN import, Practice Line, Quick Recall, Review Due availability, settings persistence, FSRS schedule persistence across reloads, overdue-card persistence, mixed White/Black board orientation, accepted alternatives, delayed same-session relearning, durable review metadata, and 320px no-horizontal-overflow checks.

GitHub Actions performs a clean npm ci, unit/integration tests, typecheck, production build, real-browser E2E coverage, and desktop/mobile browser screenshots on pull requests and supported branches.

## Scope boundary

Phase 4 intentionally focuses on adaptive **opening** review. It does **not** yet add Stockfish analysis or bot play, a full visual repertoire editor, cloud accounts/synchronization, generated tactical puzzles, middlegame/endgame training, a mistake bank, or post-game engine review. The scheduling layer is deliberately reusable so future tactics, mistake-bank, and other training content can adopt the same review infrastructure without coupling those future features into the Phase 4 opening implementation.
