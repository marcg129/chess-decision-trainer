# Phase 1 Chess Core Design

## Objective

Build a stable, responsive chess-playing core that becomes the shared foundation for opening lessons, bot play, timed decision training, game review, and mistake-based drills.

Phase 1 intentionally excludes Stockfish integration, adaptive scheduling, cloud sync, repertoire content, and advanced coaching. The goal is to make the board, rules, clocks, move telemetry, and position identity trustworthy before higher-level training features depend on them.

## Product principles

1. **Chess truth is separate from UI.** The rules/game-state layer is authoritative. The board only presents and submits moves.
2. **Timing data is first-class.** Every accepted move records exact decision time from a monotonic browser clock.
3. **Positions are durable training objects.** We store both the full FEN and a normalized training identity suitable for future transposition-aware learning.
4. **No premature engine dependency.** Phase 1 must be fully usable without Stockfish.
5. **Desktop and mobile are equal targets.** The primary board workflow must work by both drag and tap/click.
6. **Standards over custom formats.** PGN and FEN remain the primary interchange formats.

## Technology baseline

- React
- TypeScript
- Vite
- `chess.js` for legal moves, game state, FEN, and PGN
- `react-chessboard` current v5 API for board presentation and interaction
- Browser monotonic timing via `performance.now()`
- Local component state only in Phase 1

## Core architecture

### Game domain layer

A focused game controller/module owns:

- `chess.js` instance
- authoritative current FEN
- legal move application
- game-over state
- move history
- PGN export
- normalized training-position-key generation
- move telemetry records

The UI must not independently decide whether a chess move is legal.

### Board UI layer

The board is a controlled visual surface receiving the current position from the game domain layer.

It supports:

- drag-to-move
- click/tap source then destination
- legal destination indicators
- selected-square indication
- capture indication
- board flip
- promotion selection
- disabled interaction after game completion

Illegal moves leave the authoritative game state unchanged.

### Clock layer

The initial time-control target is 3+2 blitz:

- White starts with 180 seconds
- Black starts with 180 seconds
- Each legal completed move adds 2 seconds to the mover's clock
- Only the active side's clock decreases
- The clock stops on checkmate, stalemate, any other rules-engine draw/game-over condition, or timeout
- A visible **Start game** action begins White's clock and establishes the timing origin for White's first decision
- Reset returns both clocks to 180 seconds, clears telemetry, and returns the game to an unstarted state

Timing uses a monotonic browser clock and records the move's decision duration before any UI-state update can reset or overwrite the timer reference.

Phase 1 does not require multiple selectable time controls yet.

## Move telemetry

Each accepted move records at minimum:

- ply number
- moving color
- SAN
- LAN/UCI-like origin/destination representation where available
- source square
- destination square
- promotion piece when applicable
- FEN before move
- FEN after move
- normalized training position key before move
- normalized training position key after move
- decision time in milliseconds
- mover clock remaining after increment
- stable move order within the session

This schema is deliberately richer than the visible move list because later coaching depends on the historical decision context.

## Position identity

We need two representations with different purposes.

### Full FEN

Retained for exact reconstruction, rules-sensitive state, draw adjudication, and interoperability.

### Normalized training position key

Used only to group strategically/tactically equivalent positions for future repertoire mastery, transposition handling, and mistake drills. It is **not** a replacement for full FEN when determining exact legal game state.

The key is derived from:

- piece placement
- side to move
- castling rights
- effective en-passant right when an en-passant capture is actually available

Halfmove and fullmove counters are excluded from the training identity. The halfmove clock remains preserved in the full FEN because it can affect draw rules; excluding it here is a deliberate training/grouping decision rather than a claim of full legal-state equivalence.

The key generation lives in one reusable function with tests because future repertoire mastery, mistake drills, and transposition handling will depend on it.

## Promotion behavior

When a pawn reaches the final rank, the app must not silently assume queen promotion in the production interaction.

Expected behavior:

1. User makes the source/destination move.
2. If promotion is required, a compact promotion chooser appears.
3. User chooses queen, rook, bishop, or knight.
4. Only then is the move committed to the authoritative game state.

The interaction must work with mouse and touch.

## Move history and game data

The interface shows a readable move list grouped by move number.

The app also exposes/can copy or inspect:

- current FEN
- current PGN
- game result/status

Phase 1 does not require PGN import UI. Export correctness is the requirement.

## Responsive UX

Desktop target:

- board remains the dominant element
- clocks are visually obvious
- move/history panel sits beside the board when width permits

Mobile target:

- board fits the viewport width without horizontal page scrolling
- player/clock information remains readable
- move history and technical game data reflow beneath the board
- all primary controls have touch-friendly targets

The look may use familiar chess-site interaction conventions, but must not copy Chess.com branding, proprietary piece assets, artwork, sounds, or distinctive protected visual elements.

## Error handling

- Illegal moves fail safely and do not mutate state.
- A dropped piece outside the board returns to its source square.
- Invalid promotion attempts do not mutate state.
- Clock interval/animation cleanup occurs on reset and unmount.
- Game completion freezes move interaction and clock countdown.
- Timeout freezes move interaction and records the appropriate result/status.
- Reset creates a clean new game and clears telemetry.

## Testing strategy

### Unit tests

Required around domain logic:

- normal legal move
- illegal move rejection
- castling
- en passant
- each promotion type
- checkmate detection
- stalemate/draw detection
- normalized training position key excludes move counters without being used for exact rules adjudication
- ineffective FEN en-passant targets do not create distinct training keys
- equivalent transposed move orders that reach the same training position produce the same normalized key
- telemetry captures before/after FEN correctly
- increment is applied to the mover

### Timer tests

Use controlled/fake time where practical:

- clocks remain stopped before **Start game**
- Start game begins White's clock and White's first decision timer
- only active player's clock falls
- decision time is based on active-turn start to accepted-move duration
- increment is applied after a legal move
- illegal move does not switch clock or add increment
- game-over stops clocks
- timeout stops clocks and further moves
- reset clears timing state

### UI/integration tests

At minimum:

- Start game enables live play/timing
- drag legal move
- click/tap legal move
- illegal move snaps/reverts
- promotion chooser commits chosen piece
- board flip changes orientation but not game state
- game-over disables further moves

### Build verification

Before Phase 1 is called complete:

- dependency install succeeds
- TypeScript checks pass
- tests pass
- production Vite build succeeds
- app is manually smoke-tested at desktop and narrow mobile width

## Phase 1 acceptance criteria

Phase 1 is complete when all of the following are true:

1. A user can start and play a complete legal chess game on desktop or mobile using drag or click/tap.
2. Special moves work correctly: castling, en passant, and all four promotion choices.
3. 3+2 clocks behave correctly, start explicitly, enforce timeout, and stop when the game ends.
4. Every accepted move records reliable decision-time telemetry, including White's first move.
5. Move records preserve full FEN before/after and normalized training position identity before/after.
6. PGN and current FEN can be inspected/exported.
7. Checkmate, stalemate, rules-engine draws, and timeout are visibly represented and lock further play.
8. Board orientation can be flipped without changing game state.
9. Automated tests cover the domain and timing behavior described above.
10. TypeScript, tests, and production build all pass.
11. The UI is usable without horizontal page scrolling at approximately 320px width.
12. No Stockfish, cloud database, adaptive scheduler, or opening-content subsystem is required for Phase 1 to function.

## Explicitly deferred

The following are not part of Phase 1:

- Stockfish/WASM
- bot opponent
- engine evaluation bar
- opening repertoire graph
- FSRS/spaced repetition
- Move-or-Think drills
- puzzle system
- cloud account/sync
- D1/IndexedDB persistence architecture beyond any minimal local scaffolding
- Chess.com or Lichess account integrations
- AI coaching prose
- progress dashboard

## Phase 1 deliverable

A small, tested Vite/React application whose chess core can be trusted as infrastructure for every subsequent training feature.
