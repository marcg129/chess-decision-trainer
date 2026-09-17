# Phase 3 Opening Training MVP — Design

Date: 2026-09-17
Status: Approved design
Branch: `feature/phase-3-opening-training`

## Objective

Turn the Phase 1 chess core and Phase 2 local training-data foundation into the first usable opening-learning experience. Phase 3 must let a learner import real opening material from PGN, practice complete lines, drill individual positions, receive guided correction and speed feedback, and persist attempts/mastery through the existing Phase 2 data model.

The product goal remains practical decision-making rather than rote move memorization. The trainer should help the learner recognize positions, choose a repertoire move quickly, understand mistakes, and rehearse likely opponent responses without introducing engine evaluation or full spaced-repetition scheduling yet.

## Scope

Phase 3 includes:

- PGN import with nested variation support and comment preservation.
- Multi-game import preview and selective merge into one newly created repertoire.
- Explicit White/Black repertoire-side selection during import.
- One built-in demo repertoire that uses the same import/data path as user PGNs.
- A dedicated plain-TypeScript opening-training engine.
- Practice Line as the primary training mode.
- Quick Recall as a secondary position-drill mode.
- Guided correction, hints, preferred moves, accepted alternatives, and soft speed targets.
- Weighted opponent-response rotation.
- Simple weakness-weighted Quick Recall selection.
- Durable attempt/mastery updates through the Phase 2 repository/service boundaries.
- A focused Train UI plus top-level Train / Play / Data navigation.
- Unit, integration, persistence, and real-browser coverage.

Phase 3 explicitly does not include:

- Stockfish evaluation or engine-based correctness.
- FSRS or date-based spaced-repetition scheduling.
- A full visual repertoire editor.
- Appending/import-merging new PGN material into an existing repertoire.
- Cloud accounts or synchronization.
- Bot play beyond the existing free-play board.
- Tactical, middlegame, endgame, or post-game mistake generation.
- Sync conflict handling.

## Architectural direction

Phase 3 adds a dedicated opening-training engine rather than placing training behavior directly in React or creating a generalized lesson framework prematurely.

High-level flow:

```text
PGN / built-in demo
        ↓
PGN Import Parser
        ↓
Import Preview + Validation
        ↓
Phase 2 Repertoire Graph
        ↓
Opening Training Engine
        ↓
Opening Training Session
        ↓
React Training UI
        ↓
Phase 2 Attempts + Mastery
```

The existing Phase 2 canonical position graph remains the durable source of repertoire truth. Phase 3 must not create a separate opening tree that duplicates positions or bypasses the repository layer.

React remains a thin presentation layer. Chess legality stays with the existing chess domain. Dexie remains hidden behind persistence/repository services.

## Component boundaries

### PGN import parser

Responsibilities:

- Parse one or more PGN games from an imported file/string.
- Preserve nested Recursive Annotation Variations.
- Preserve useful comments/annotations as import metadata.
- Produce a parser-neutral intermediate representation that can be validated without touching IndexedDB.

Non-responsibilities:

- Persisting repertoires.
- Deciding chess legality independently of the existing chess domain.
- Running training sessions.

A PGN parser/library may be used for syntax/variation-tree parsing, but every derived chess transition must still be verified through the app's chess domain before persistence.

### Import preview and validator

Responsibilities:

- Present all parsed games before import.
- Let the learner select which games belong in the new repertoire.
- Require a new repertoire name and side: White or Black.
- Show import counts and warnings before mutation.
- Validate every selected variation and move progression.
- Convert selected lines into canonical repertoire transitions.
- Fail atomically if any selected branch is invalid or unsupported.

The importer must report the failing game and variation path when possible.

Phase 3 imports always create a new repertoire. It may reuse canonical positions and move edges already present globally, but it does not mutate an existing repertoire's membership. Editing or merging into an existing repertoire is deferred to a later repertoire-management milestone.

### Repertoire graph mapping

Selected games merge into one new Phase 2 repertoire.

For every legal transition:

- Canonical positions and move edges are reused when already present.
- Transpositions converge naturally through normalized position identity.
- Moves by the selected repertoire side map to learner repertoire moves.
- Moves by the opposite side map to opponent repertoire moves.
- The earliest selected game in source-PGN order that reaches a learner position determines that position's default preferred move from its main line.
- A later selected game's different main-line learner move at the same position is imported as an accepted alternative, not a second preferred move.
- The import preview warns when selected games disagree on the default preferred move at the same learner position.
- Other imported learner variations remain accepted alternatives.
- PGN comments attach to the relevant repertoire move explanation or repertoire-position notes according to where the comment occurs.

Repeated imports of overlapping material may create separate repertoires, but they must reuse the same canonical positions and move edges rather than manufacture duplicate graph nodes.

### Opening training engine

The engine is plain TypeScript and depends only on chess-domain and repository/service interfaces.

Responsibilities:

- Load a repertoire training view from persisted graph data.
- Create Practice Line and Quick Recall sessions.
- Track the current training position and learner side.
- Expose preferred and accepted learner moves for grading.
- Select opponent replies.
- Track first/second misses, hints, reveal state, decision timing, and progress.
- Resolve attempts into the Phase 2 attempt/mastery path.
- Advance only after a durable attempt write succeeds.

The engine must not import React or Dexie.

### React training UI

Responsibilities:

- Render the training session state exposed by the engine.
- Send learner moves and hint requests to the engine.
- Render compact correction/speed/explanation feedback.
- Keep the board dominant and uncluttered.
- Reuse one training layout for both Practice Line and Quick Recall.

The UI must not independently implement grading, branch weighting, or persistence rules.

## PGN import experience

### Import flow

```text
Select PGN file
  → parse all games
  → show game list
  → select games
  → choose White/Black repertoire side
  → name new repertoire
  → build preview
  → validate every selected branch
  → show counts/warnings
  → confirm import
  → transactional persistence
```

No durable data is written before the selected import fully validates.

### Multi-game behavior

The import screen shows parsed games and lets the learner choose any subset. The selected games are merged into one newly created repertoire rather than automatically creating one repertoire per game or blindly combining every game in the file.

Source-PGN order among the selected games is preserved and is used only as the deterministic tie-breaker for conflicting preferred main-line learner moves.

### Built-in demo repertoire

Phase 3 ships one small built-in repertoire fixture. Choosing the demo runs the same parser/validation/graph-import service used by user PGNs; no special-case training logic may depend on demo content. Demo installation must be idempotent for a local data set so repeated attempts to open the demo do not create duplicate demo repertoires.

## Training modes

### Practice Line

Practice Line is the primary experience.

A session begins from the repertoire root and follows imported graph transitions until the selected branch reaches a repertoire endpoint.

When it is the learner's turn:

- The board is interactive.
- A decision timer starts.
- Preferred and accepted repertoire moves define correctness.
- Hints remain hidden until requested.

When it is the opponent's turn:

- The engine automatically selects and plays one imported opponent response.
- Selection uses weighted rotation that favors unseen or less-practiced branches.
- The weighting remains intentionally simple and is not FSRS.

Practice Line ends when the active branch reaches a repertoire endpoint.

### Quick Recall

Quick Recall jumps directly to trainable repertoire positions instead of replaying from move one.

Default session size: 10 resolved learner prompts. The learner may stop early.

Position selection is simple weakness-weighted selection. Higher weight goes to positions that are unseen, previously incorrect, hint-heavy, or slower than target.

Selection may use aggregate mastery plus recent attempt history, but it must not create date-based scheduling or FSRS semantics in Phase 3.

## Learner move grading

At a trainable learner position:

- Exactly one repertoire move is preferred.
- Other imported learner moves may be accepted alternatives.
- Preferred move: correct, full positive feedback.
- Accepted alternative: still correct, but feedback identifies the preferred repertoire move.
- Non-repertoire legal move: incorrect for this trainer even if it may be objectively playable chess.
- Illegal move: rejected by the chess domain and not recorded as a resolved attempt.

Stockfish does not participate in grading.

## Guided correction

Correction follows this sequence:

1. First incorrect repertoire move:
   - Do not advance.
   - Record the miss in transient prompt state.
   - Prompt the learner to look again.
   - Keep a hint available.
2. Second incorrect repertoire move:
   - Reveal the preferred move and relevant explanation/comment when available.
   - Do not auto-play the answer.
3. The learner must physically make an accepted correct move before the position resolves and the session can persist/advance.

The durable attempt must preserve the quality of the original recall rather than misrepresenting a corrected prompt as a clean first-try success. Phase 3 therefore may extend attempt metadata with backward-compatible fields such as wrong-attempt count and first submitted move if the current Phase 2 fields cannot represent this accurately. Any extension must be versioned, migration-tested, and backup-safe.

## Hints and explanations

PGN comments/explanations are hidden by default.

A hint request:

- increments hint usage/count,
- may reveal progressively useful information,
- must not silently submit a move,
- and is reflected in the final attempt quality/history.

After a resolved attempt, the explanation/comment may be shown automatically.

## Decision-speed feedback

Every learner prompt records decision time.

Phase 3 uses soft targets only:

- A correct move never becomes incorrect solely because it was slow.
- Feedback may show examples such as `Correct · 3.8s · Good speed` or `Correct · 8.4s · target under 5s`.
- The initial target is a simple configurable constant rather than an adaptive timing model.

Hard countdown penalties belong to a later practical-speed milestone.

## Weighted opponent-response selection

When multiple opponent responses exist from the same position, the engine uses weighted rotation rather than always following the PGN main line or uniformly random selection.

The weighting prefers responses with less learner exposure. A simple implementation may derive weight from persisted exposure/mastery information plus session-local exposure counts.

Requirements:

- unseen/less-practiced branches receive greater selection weight,
- heavily repeated branches receive lower weight,
- every valid branch remains selectable,
- selection logic accepts an injectable random/selection source for deterministic tests.

No adaptive scheduling timestamps are introduced.

## Quick Recall weakness weighting

Quick Recall uses similarly simple weights.

Signals may include:

- no prior attempts,
- lower mastery score,
- recent incorrect attempts,
- higher hint use,
- slower average decision time.

The exact formula belongs in the implementation plan, but it must be explainable, deterministic under an injected selector, and intentionally simpler than FSRS.

## Session persistence and failure behavior

Each resolved learner decision writes through the existing Phase 2 attempt/mastery path.

Normal flow:

```text
prompt
 → learner move(s)
 → resolve feedback
 → build attempt
 → persist attempt + mastery atomically
 → acknowledge success
 → advance
```

If persistence fails:

- the trainer must not advance,
- the resolved board/feedback remains visible,
- the user sees a clear storage error,
- the user can retry persistence without replaying the position,
- duplicate attempts must not be created by repeated retry actions.

The engine must distinguish `resolved-but-not-persisted` from `persisted-and-ready-to-advance`.

## Navigation and UI structure

Phase 3 introduces top-level navigation:

- Train
- Play
- Data

`Play` preserves the current free-play chess board.

`Data` preserves the Phase 2 training-data utility surfaces.

`Train` becomes the default opening-training surface for this milestone.

### Training home

The training home shows the selected repertoire and two primary actions:

- Practice Line — primary action.
- Quick Recall — secondary action.

It also provides a route to repertoire import/inspection.

### Desktop training layout

The board remains dominant on the left. Session state, timing, hints, progress, and compact feedback appear on the right.

### Mobile training layout

At approximately 320px and above, the layout stacks vertically:

1. session header,
2. board,
3. feedback/actions,
4. progress.

No horizontal overflow is acceptable.

### Feedback examples

Preferred move:

```text
✓ Correct — Nf3
3.8s · Good speed
```

Accepted alternative:

```text
✓ Correct — Bc4 is in your repertoire
Preferred: Nf3
```

First miss:

```text
Not quite. Look again.
[Hint]
```

Second miss:

```text
Try Nf3.
Develop the knight before committing the center.
```

The learner must still make the correct move on the board.

## Data model implications

Phase 2 already provides:

- canonical positions,
- canonical move edges,
- repertoire positions,
- repertoire moves with role/preferred/explanation,
- position mastery,
- repertoire-move mastery,
- sessions,
- attempts.

Phase 3 should reuse these structures wherever possible.

Repository interfaces will likely need read/query capabilities for:

- listing repertoire positions and moves,
- resolving outgoing repertoire transitions for a position,
- loading mastery/attempt summaries needed for weighting,
- loading trainable positions,
- performing transactional bulk import,
- and idempotently ensuring the built-in demo repertoire.

Any required schema additions must be minimal, versioned, backup-safe, and covered by migration tests.

A full editor-oriented model expansion is out of scope.

## Error handling

### PGN parse errors

- Report file/game context when possible.
- Do not persist partial data.
- Allow the user to return to selection and exclude a bad game.

### Illegal or inconsistent variation

- Identify the affected game/variation when possible.
- Reject the selected import transaction.
- Leave prior local data unchanged.

### Storage failure during import

- Roll back the entire repertoire import.
- Report a recoverable error.

### Storage failure during training

- Hold the resolved prompt in place.
- Allow idempotent persistence retry.
- Do not advance or silently lose the attempt.

### Missing repertoire data

If a persisted repertoire contains a broken reference or no valid continuation for the expected side, stop the session with a clear data error instead of guessing or switching to arbitrary legal chess moves.

## Testing strategy

Phase 3 must retain the Phase 2 verification bar and add targeted coverage for the new behavior.

### PGN/import unit and integration coverage

- single-game PGN import,
- multi-game parsing and selective merge,
- nested variations,
- comments/explanations,
- White/Black role assignment,
- deterministic preferred-move conflict handling with preview warning,
- accepted learner alternatives,
- transposition convergence,
- overlapping material across separately imported repertoires reusing canonical graph nodes,
- illegal variation rejection,
- transactional rollback with no partial import,
- idempotent demo installation.

### Training-engine coverage

- Practice Line startup and completion,
- opponent auto-response,
- weighted branch selection,
- preferred learner move grading,
- accepted alternative grading,
- first miss → retry,
- second miss → reveal,
- required manual correct move after reveal,
- wrong-attempt/hint quality retained in the durable attempt,
- hint tracking,
- soft speed feedback,
- attempt construction,
- persistence success before advance,
- persistence failure + idempotent retry,
- Quick Recall 10-position default,
- weakness-weighted position selection,
- early session stop.

Randomized/weighted logic must accept injectable selection input so tests are deterministic.

### UI/browser coverage

- Train / Play / Data navigation,
- repertoire import preview and confirmation,
- import → reload → persisted repertoire,
- Practice Line browser smoke,
- Quick Recall browser smoke,
- real attempt persistence across reload,
- persistence-error presentation where practical,
- 320px no-horizontal-overflow check,
- desktop and mobile screenshots.

### CI

CI continues to run:

- clean `npm ci`,
- unit/integration tests,
- typecheck,
- production build,
- Playwright real-browser tests,
- browser screenshot smoke.

## Success criteria

Phase 3 is complete when a user can:

1. Open the app and enter Train mode.
2. Try the built-in demo repertoire without manually importing a PGN.
3. Import a PGN containing multiple games and nested variations.
4. Select a subset of games, choose White or Black, preview the import, and atomically create one repertoire.
5. See a warning when selected games disagree on a preferred main-line learner move, with deterministic source-order precedence.
6. Practice a complete line while the app supplies weighted opponent replies.
7. Receive preferred/alternative grading, guided correction, hints, comments, and soft speed feedback.
8. Complete a 10-position Quick Recall session biased toward weaker/unseen positions.
9. Reload the browser and retain imported repertoire data, attempts, and mastery.
10. Use the workflow at roughly 320px width without horizontal overflow.
11. Complete all automated verification with the existing chess/play/data behavior still intact.

## Deferred follow-on work

Phase 4 may add adaptive scheduling/FSRS on top of the attempts/mastery generated here.

Later milestones may add a visual repertoire editor and existing-repertoire merge/import, Stockfish analysis, bot play, mistake-bank training, generated tactics, middlegame/endgame study, post-game review, and the signature MOVE OR THINK? practical-speed mode.
