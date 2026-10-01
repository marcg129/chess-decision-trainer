# Phase 4 Adaptive Review & Spaced Repetition Design

Date: 2026-10-01

## Status

Approved for implementation.

## Objective

Phase 4 adds adaptive, date-based spaced-repetition review for opening repertoires without weakening the deliberate Practice Line and Quick Recall workflows built in Phase 3.

The goal is to make the app answer a new question reliably:

> Which opening decisions should the learner review now, and how should successful or failed recall change the next review date?

Phase 4 must preserve the project's practical focus: faster, better chess decisions for short time controls, especially 3+2 blitz. Scheduling should reinforce long-term recall without interrupting rapid decision practice with self-rating prompts.

## Product decisions

The following decisions are locked:

1. Scheduling is repertoire-specific. A preferred move in one repertoire has an independent schedule from a different repertoire, even if both originate from the same canonical chess position.
2. Shared position mastery remains descriptive and does not directly suppress or advance repertoire review schedules.
3. Review grades are automatic. The learner never has to choose Again, Hard, Good, or Easy manually.
4. Speed grading is hybrid: the existing 5-second practical target remains meaningful, while personal historical speed is also considered.
5. A new Review Due mode owns spaced-repetition scheduling.
6. Practice Line and Quick Recall continue to record attempts and descriptive mastery but do not advance FSRS schedules.
7. New-item introduction is limited daily and is user-configurable. Default: 10 new cards per local calendar day.
8. Due-review backlog is never artificially postponed. Sessions are served in manageable batches. Default batch size: 15 unique cards.
9. Review Due is global across all active repertoires, with optional repertoire filtering.
10. New material is balanced across active repertoires so one large import cannot monopolize the daily allowance.
11. A failed scheduled recall is graded Again once, then enters same-session relearning.
12. Relearning may reappear only after at least three intervening prompts and approximately two minutes, whichever requires longer.
13. The original failed scheduled recall remains the long-term FSRS signal. A successful same-session relearning attempt does not reschedule the card.
14. The scheduler is implemented through ts-fsrs behind an internal adapter.
15. One scheduled card corresponds to one trainable repertoire position and its preferred learner move.
16. Accepted alternatives remain valid chess answers but receive Hard in Review Due because they do not demonstrate exact recall of the preferred repertoire continuation.
17. The scheduling subsystem is reusable by future training content, but Phase 4 only implements opening review.

## Existing foundation

Phase 2 already introduced:

- canonical positions and move edges,
- repertoire-specific move records,
- shared position mastery,
- repertoire-move mastery,
- durable attempt history,
- atomic attempt/mastery persistence,
- IndexedDB through Dexie,
- versioned backup/restore.

Phase 3 added:

- preferred and accepted alternative opening moves,
- Practice Line and Quick Recall engines,
- hints and guided correction,
- a 5-second soft decision target,
- durable attempts with stable retry-safe attempt IDs,
- browser-level E2E coverage.

The current `RepertoireMoveMastery` and `PositionMastery` records already reserve `nextReviewAt` and `schedulingData`. Phase 4 activates those fields rather than introducing a separate card table.

## Architecture

Phase 4 uses a dedicated scheduling subsystem rather than embedding FSRS behavior directly into `OpeningTrainingEngine`.

High-level flow:

```
Review Due prompt
  -> chess response evaluation
  -> automatic review grader
  -> scheduling policy
  -> FSRS adapter
  -> atomic attempt + mastery persistence
  -> updated due queue
```

The subsystem contains four principal responsibilities:

### 1. Automatic review grader

The grader converts observable training behavior into one normalized review rating:

- `again`
- `hard`
- `good`
- `easy`

The grader is pure and does not access storage or ts-fsrs directly.

Inputs include:

- first legal response correctness,
- whether the preferred move was recalled,
- whether an accepted alternative was chosen,
- hint usage,
- decision time,
- target decision time,
- historical baseline for the scheduled move,
- amount of prior review history.

Initial balanced policy:

- wrong first legal move -> Again,
- any hint before successful recall -> Again,
- accepted alternative -> Hard,
- clean preferred recall that is materially slow -> Hard,
- clean preferred first-try recall at reasonable speed -> Good,
- fast, clean, established preferred recall -> Easy.

The 5-second target remains the practical absolute benchmark.

Personal improvement is recognized using historical average decision time. The initial material-improvement threshold is 20%. A response that remains slower than 5 seconds may still avoid Hard when it represents substantial improvement and otherwise demonstrates clean recall.

Easy is intentionally conservative. Initial policy requires:

- preferred move,
- first legal response correct,
- no hint,
- decision time at or below 3 seconds,
- sufficient prior successful review history.

All numeric thresholds live in one policy module and are not duplicated through UI or engine code.

### 2. FSRS adapter

The project will use stable `ts-fsrs` 5.4.x behind an internal adapter.

No component outside the adapter imports ts-fsrs types.

The adapter accepts:

- normalized internal scheduling state,
- one normalized rating,
- review timestamp.

It returns:

- next normalized scheduling state,
- next due timestamp.

This boundary keeps the rest of the application independent from library object shapes and makes future library upgrades or replacement possible without rewriting the training engine.

### 3. Due queue builder

The due queue service builds a global review inventory from active repertoires.

Priority order:

1. overdue and due scheduled cards,
2. eligible new cards, subject to the remaining daily new-item allowance.

Scheduled due cards are ordered primarily by `nextReviewAt` ascending. Older overdue material therefore comes first.

New cards are introduced round-robin across active repertoires. Within each repertoire, material follows opening depth/source order so earlier opening decisions are normally introduced before deeper continuations.

Archived repertoires do not enter the queue.

Optional repertoire filtering narrows both due and new inventory without changing underlying due dates.

### 4. Review training engine

A separate `ReviewTrainingEngine` coordinates global Review Due sessions.

It owns:

- mixed-repertoire queue progression,
- per-card learner orientation,
- prompt state,
- response evaluation,
- automatic grading,
- persistence retry,
- same-session relearning,
- batch completion,
- session summary.

`OpeningTrainingEngine` remains responsible for Practice Line and Quick Recall.

Shared chess-prompt behavior should be extracted only where it reduces real duplication; Phase 4 should not refactor unrelated Phase 3 code.

## Scheduled card identity

A scheduled opening card is identified by the preferred `RepertoireMove` for a trainable repertoire position.

The card's durable schedule is stored in that preferred move's `RepertoireMoveMastery`.

This means:

- one trainable position produces one scheduled preferred target,
- accepted alternatives are not separate cards,
- the same canonical position in two repertoires may have two independent cards,
- shared `PositionMastery` continues to aggregate recognition/performance history across contexts.

## Scheduling state

`RepertoireMoveMastery.nextReviewAt` is the canonical simple due timestamp used for queries and display.

`RepertoireMoveMastery.schedulingData` stores a project-owned JSON-safe envelope, not a raw ts-fsrs object.

Version 1 envelope:

```ts
type FsrsSchedulingEnvelopeV1 = {
  kind: 'fsrs';
  schedulingSchemaVersion: 1;
  library: {
    name: 'ts-fsrs';
    major: 5;
  };
  card: {
    due: string;
    stability: number;
    difficulty: number;
    elapsedDays: number;
    scheduledDays: number;
    reps: number;
    lapses: number;
    state: 'new' | 'learning' | 'review' | 'relearning';
    lastReviewAt: string | null;
  };
};
```

The adapter maps this structure to and from ts-fsrs.

Unknown future scheduling schema versions must fail validation explicitly rather than being silently interpreted.

## Mastery state and score

Existing `MasteryState` and `score` remain application-level descriptive concepts.

Phase 4 should make them meaningful but keep them separate from raw FSRS internals.

Initial mapping should be deterministic and derived from review state plus observed performance. The exact score formula belongs in one mastery-policy module and is covered by tests.

FSRS stability or difficulty must not be exposed directly as the application's mastery score.

## Persistence model

### Dexie schema v3

Phase 4 introduces database schema version 3.

The `repertoireMoveMastery` store gains an index on `nextReviewAt` to support efficient due queries.

Records with no schedule remain valid. New/unseen targets are identified by missing/null scheduling data rather than treated as overdue scheduled cards.

No separate cards table is required.

### Learner review settings

`LearnerProfile` gains optional review settings:

```ts
type ReviewSettings = {
  newItemsPerDay: number; // default 10
  batchSize: number;      // default 15
};
```

Existing learner records without settings resolve to defaults and may be lazily normalized on update.

Validation ranges should prevent unusable values. Initial accepted ranges:

- new items/day: 0-100,
- batch size: 1-100.

### Attempt review metadata

`TrainingAttempt` gains optional Review Due metadata so historical records explain scheduling decisions.

```ts
type ReviewAttemptMetadata = {
  targetRepertoireMoveId: EntityId;
  rating: 'again' | 'hard' | 'good' | 'easy';
  kind: 'scheduled' | 'relearning';
  schedulingApplied: boolean;
};
```

Important semantics:

- `repertoireMoveId` continues to mean the accepted move actually played when one exists.
- `review.targetRepertoireMoveId` identifies the preferred move whose memory was being tested.
- accepted alternative: actual move ID differs from review target ID,
- failed scheduled recall: target exists even though the first response did not match any accepted move,
- relearning attempts set `schedulingApplied: false`.

### Atomic scheduled attempt write

The repository gains a dedicated scheduled-review persistence operation rather than forcing the caller to perform multiple writes.

One transaction must:

1. honor a stable attempt ID for idempotency,
2. validate repertoire/position/target relationships,
3. record the attempt,
4. update shared position mastery,
5. update actual repertoire-move mastery where appropriate,
6. update the preferred target's scheduling state exactly once when `schedulingApplied` is true,
7. preserve all-or-nothing behavior.

Retrying the same stable attempt ID must return the existing attempt and must not advance the FSRS card a second time.

Practice Line and Quick Recall continue through the ordinary attempt path and do not mutate scheduling state.

## Backup format

Phase 4 introduces `TrainingBackupV2`.

V2 includes:

- learner review settings,
- v3 database data,
- Review Due attempt metadata,
- FSRS scheduling envelopes.

Restore must accept both V1 and V2.

V1 restore behavior:

- restores all Phase 2/3 data,
- missing review settings resolve to defaults,
- existing mastery records retain null schedules,
- no synthetic review history is invented.

New exports use V2 only.

Restore remains replace-atomic and still creates the existing pre-restore recovery backup.

## Daily new-item allowance

The default global allowance is 10 new cards per local calendar day.

The system must determine how many new scheduled introductions have already occurred during the current browser-local calendar day from durable Review Due attempt metadata. Reloading or restarting the browser must not reset the allowance.

Only first scheduled introductions count against the allowance.

Same-session relearning does not consume another new-item slot.

Changing the configured limit affects remaining capacity for the current day without rewriting historical attempts.

## Batch construction

Default batch size is 15 unique cards.

A batch may contain:

- due cards,
- new cards if daily allowance remains.

If 65 cards are overdue and batch size is 15, all 65 remain overdue. The session simply serves at most 15 unique cards initially.

At batch completion, the UI may offer Continue Reviewing when more due/new-eligible material remains.

Same-session relearning may cause total prompts in the session to exceed the unique-card batch size. The batch-size setting limits initial unique targets, not reinforcement prompts.

## New-card balancing

New cards are distributed round-robin among active repertoires.

Within each repertoire, introduction order uses opening structure:

1. lower graph depth before deeper positions,
2. imported/source order as the tie-breaker,
3. stable IDs as a final deterministic tie-breaker.

This prevents an imported 100-position repertoire from consuming all daily introductions while another active repertoire receives none.

## Review response behavior

Review Due reuses Phase 3's board interaction, legal move validation, accepted alternatives, hints, and guided correction principles.

### Preferred move

A clean preferred first response is graded by speed/history as Hard, Good, or Easy.

### Accepted alternative

An accepted alternative:

- is displayed as a correct chess response,
- does not enter the wrong-move correction loop,
- receives Hard,
- schedules the preferred target card,
- records the actual accepted repertoire move separately from the scheduled target.

### Incorrect move

A wrong first legal response:

- records the scheduled recall outcome as Again,
- uses guided correction until the learner physically plays the preferred move,
- applies FSRS only once from the original Again outcome,
- queues the target for later same-session relearning.

### Hint

Using a hint before successful recall makes the scheduled outcome Again.

The learner still completes the move physically before progression.

## Same-session relearning

A failed scheduled target is inserted into a relearning queue.

It becomes eligible only when both are true:

- at least three other prompts have been presented since failure,
- at least 120 seconds have elapsed since failure.

If a session lacks enough material to satisfy the spacing naturally, the engine keeps the failed target near the end instead of immediately repeating it.

The relearning prompt is persisted as a separate attempt with:

- `kind: 'relearning'`,
- `schedulingApplied: false`.

Its success or failure contributes to attempt history and descriptive mastery but does not change the FSRS schedule created from the original failed scheduled attempt.

A failed relearning prompt may remain unresolved at session end; Phase 4 does not repeatedly reschedule FSRS within the same batch.

## Session completion

Review Due sessions store normal `TrainingSession` records using mode `opening:review-due`.

Session summary includes at minimum:

- unique cards reviewed,
- first-response preferred recalls,
- Hard outcomes,
- Again outcomes,
- relearning prompts completed,
- average decision time,
- remaining due count when known.

The summary is descriptive. It does not modify schedules.

## UI

The Train surface adds Review Due alongside Practice Line and Quick Recall.

Training home displays current global inventory, for example:

```
12 due · 6 new available
```

Review Due controls include:

- Start Review,
- optional repertoire filter,
- new-items/day setting,
- batch-size setting.

During a mixed session:

- board orientation follows the current repertoire side,
- repertoire name is visible,
- progress refers to unique batch targets,
- feedback distinguishes preferred, accepted alternative, failed recall, and relearning,
- rating words do not need to dominate the learner-facing UI.

The learner should not interact with Again/Hard/Good/Easy buttons.

At completion:

- compact summary,
- Finish,
- Continue Reviewing when inventory remains.

Responsive behavior must remain usable at 320px without horizontal overflow.

## Time handling

Scheduling timestamps are stored as UTC ISO timestamps.

Due comparisons use absolute instants.

The daily new-item allowance uses the browser's local calendar date at session construction time.

Tests must inject time rather than depend on the actual wall clock.

## Error handling

Review Due must preserve Phase 3's retry-safe persistence behavior.

If a scheduled attempt cannot be saved:

- do not advance to the next card,
- keep the resolved prompt visible,
- provide retry,
- retry uses the same stable attempt ID,
- the scheduler must not advance twice.

If scheduling data is malformed or unsupported:

- surface a clear recoverable training error,
- do not silently reset the card,
- leave source records untouched.

If a repertoire becomes invalid or is missing its preferred target:

- skip no data silently,
- fail the affected session construction with an actionable message.

## Dependency policy

Use stable `ts-fsrs` 5.4.x, pinned through the package lock.

Do not adopt the 6.x beta during Phase 4.

The adapter isolates the dependency so a later major upgrade can be handled as a focused migration.

## Testing strategy

Implementation remains task-by-task TDD.

Required unit/integration coverage:

1. automatic rating boundaries,
2. historical-speed improvement behavior,
3. accepted alternative -> Hard,
4. hint -> Again,
5. wrong first response -> Again,
6. deterministic FSRS adapter conversion,
7. scheduling envelope validation,
8. due ordering,
9. new-card daily limits,
10. round-robin repertoire balancing,
11. stable within-repertoire introduction order,
12. batch-size behavior,
13. same-session relearning prompt/time gates,
14. relearning does not reschedule,
15. ordinary Practice Line/Quick Recall attempts do not schedule,
16. atomic scheduled persistence,
17. stable attempt retry cannot double-schedule,
18. Dexie v2 -> v3 migration,
19. V1 backup restore into Phase 4,
20. V2 export/restore,
21. mixed White/Black Review Due sessions,
22. settings validation and defaults,
23. malformed scheduling-data handling.

Browser E2E must verify at least:

- Review Due appears on Train,
- new cards can be introduced and persist after reload,
- a scheduled due card remains scheduled across reload,
- mixed-repertoire orientation works,
- accepted alternative behavior,
- failed recall and delayed relearning path,
- settings persist,
- 320px layout has no horizontal overflow.

Full existing verification remains mandatory:

```
npm test
npm run typecheck
npm run build
npm run test:e2e
```

## Scope exclusions

Phase 4 does not add:

- Stockfish analysis,
- engine-based move grading,
- bot play,
- generated tactics,
- middlegame/endgame curriculum,
- mistake bank,
- post-game engine review,
- cloud accounts or synchronization,
- a visual repertoire editor,
- advanced scheduling parameter tuning UI,
- learned FSRS parameter optimization.

The architecture should allow future scheduled content to reuse the scheduler adapter and queue concepts, but no speculative generic content framework should be built in Phase 4.

## Success criteria

Phase 4 is complete when:

1. the learner can start a global Review Due session,
2. due cards are prioritized correctly,
3. controlled new cards are introduced across repertoires,
4. every scheduled response is automatically graded,
5. only Review Due changes long-term schedules,
6. failures create appropriately spaced same-session relearning,
7. persistence and retries cannot double-advance schedules,
8. existing local data and V1 backups remain usable,
9. the flow works across reloads and at mobile width,
10. all legacy Phase 1-3 tests plus new Phase 4 tests pass.
