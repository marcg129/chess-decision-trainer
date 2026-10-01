# Phase 4 Adaptive Review & Spaced Repetition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global, automatic, FSRS-backed Review Due workflow for opening repertoires while preserving Practice Line and Quick Recall as unscheduled practice modes.

**Architecture:** Add a focused `src/review` domain containing grading, FSRS adaptation, queue construction, and the global review engine. Extend the existing Dexie repository with v3 due indexing and one atomic scheduled-attempt operation. Keep `OpeningTrainingEngine` unchanged except where shared UI/domain utilities are genuinely reusable.

**Tech Stack:** React 19.3.0, TypeScript 7.0.2, Vite 8.3.0, Vitest 5.0.1, Playwright 1.63.0, Dexie 4.4.6, chess.js 1.4.0, Zod 4.6.5, ts-fsrs 5.4.2.

**Spec:** `docs/superpowers/specs/2026-10-01-phase-4-adaptive-review-design.md`

## Global Constraints

- Use stable `ts-fsrs` 5.4.2; do not adopt 6.x beta.
- Only Review Due may mutate FSRS scheduling state.
- One scheduled card equals one trainable repertoire position's preferred move.
- Accepted alternatives are correct chess responses but grade Hard in Review Due.
- Wrong first response or any hint grades Again.
- Absolute speed target is 5,000 ms; material personal improvement is 20%; Easy requires <=3,000 ms and at least two prior scheduling-applied reviews.
- Default new items/day is 10; valid range 0-100.
- Default unique-card batch size is 15; valid range 1-100.
- Failed cards may reappear only after at least three intervening prompts and 120 seconds.
- Relearning never mutates FSRS scheduling state.
- Scheduling timestamps are UTC ISO strings; daily new-card accounting uses the browser-local calendar day.
- Existing V1 backups must restore; new exports use V2.
- All scheduled persistence must remain atomic, retry-idempotent, and stale-write safe.
- 320px layouts must not horizontally overflow.

## Review Focus

- Unsupported/corrupted scheduling envelope: reject explicitly and leave stored records unchanged; Task 2 pins this.
- Concurrent stale scheduled write: reject the later conflicting attempt rather than overwrite a newer schedule; Task 4 pins this.
- Local-midnight daily allowance: count only `review.newCard` attempts within the injected local-day bounds; Task 6 pins this.
- Accepted alternative identity: persist the actual alternative move separately while scheduling the preferred target as Hard; Tasks 4 and 7 pin this.
- Session ends before a failed card becomes relearning-eligible: finish without waiting or immediate repeat; keep the Again schedule from the original review; Task 7 pins this.

---

### Task 1: Review Domain Contracts, Settings, and Automatic Grading

**Files:**
- Create: `src/review/types.ts`
- Create: `src/review/settings.ts`
- Create: `src/review/grader.ts`
- Test: `src/review/settings.test.ts`
- Test: `src/review/grader.test.ts`
- Modify: `src/training/types.ts`

**Interfaces:**
- Produces: `ReviewRating = 'again' | 'hard' | 'good' | 'easy'`
- Produces: `ReviewSettings { newItemsPerDay: number; batchSize: number }`
- Produces: `DEFAULT_REVIEW_SETTINGS`
- Produces: `normalizeReviewSettings(input?: Partial<ReviewSettings>): ReviewSettings`
- Produces: `ReviewAttemptMetadata { targetRepertoireMoveId; rating; kind; schedulingApplied; newCard }`
- Produces: `gradeReview(input: ReviewGradeInput): ReviewRating`
- Extends: `LearnerProfile.reviewSettings?: ReviewSettings`
- Extends: `TrainingAttempt.review?: ReviewAttemptMetadata`

- [ ] **Step 1: Write failing settings tests**
  - Defaults resolve to `{ newItemsPerDay: 10, batchSize: 15 }`.
  - 0 and 100 new items/day are accepted; -1 and 101 reject.
  - 1 and 100 batch size are accepted; 0 and 101 reject.

- [ ] **Step 2: Run settings tests and confirm RED**

Run: `npm test -- src/review/settings.test.ts`  
Expected: FAIL because review settings module does not exist.

- [ ] **Step 3: Implement review settings contracts and normalization**

Implement `normalizeReviewSettings` with integer/range validation and explicit errors.

- [ ] **Step 4: Run settings tests and confirm GREEN**

Run: `npm test -- src/review/settings.test.ts`  
Expected: PASS.

- [ ] **Step 5: Write failing grading tests**
  - wrong first response -> Again,
  - hint used -> Again,
  - accepted alternative -> Hard,
  - preferred first response at 7,000 ms with no useful baseline -> Hard,
  - preferred first response at 7,000 ms with historical average 9,000 ms -> Good because improvement >=20%,
  - preferred first response at 4,500 ms -> Good,
  - preferred clean response at 2,500 ms with two prior scheduled reviews -> Easy,
  - same 2,500 ms response with fewer than two prior reviews -> Good.

- [ ] **Step 6: Run grading tests and confirm RED**

Run: `npm test -- src/review/grader.test.ts`  
Expected: FAIL because `gradeReview` does not exist.

- [ ] **Step 7: Implement `gradeReview(input: ReviewGradeInput): ReviewRating`**

Use constants `TARGET_DECISION_MS = 5000`, `EASY_DECISION_MS = 3000`, and `MATERIAL_IMPROVEMENT_RATIO = 0.8`.

- [ ] **Step 8: Run Task 1 tests and confirm GREEN**

Run: `npm test -- src/review/settings.test.ts src/review/grader.test.ts`  
Expected: PASS.

- [ ] **Step 9: Commit**

Commit message: `feat: define adaptive review grading`

### Task 2: FSRS Adapter and Scheduling Envelope

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/review/fsrsAdapter.ts`
- Create: `src/review/fsrsAdapter.test.ts`

**Interfaces:**
- Consumes: `ReviewRating` from Task 1.
- Produces: `FsrsSchedulingEnvelopeV1`
- Produces: `ScheduledReviewResult { schedulingData: FsrsSchedulingEnvelopeV1; nextReviewAt: string }`
- Produces: `parseFsrsSchedulingEnvelope(input: unknown): FsrsSchedulingEnvelopeV1`
- Produces: `FsrsScheduler.schedule(current: FsrsSchedulingEnvelopeV1 | null, rating: ReviewRating, reviewedAt: Date): ScheduledReviewResult`
- No file outside `src/review/fsrsAdapter.ts` imports from `ts-fsrs`.

- [ ] **Step 1: Add exact dependency `ts-fsrs@5.4.2` and update the lockfile**

Run: `npm install --save-exact ts-fsrs@5.4.2`  
Expected: package and lockfile record 5.4.2.

- [ ] **Step 2: Write failing adapter tests**
  - new Good review returns a valid version-1 envelope and future `nextReviewAt`,
  - repeated scheduling from a saved envelope is deterministic for the same timestamp/rating,
  - all four ratings map to the corresponding ts-fsrs rating,
  - serialized dates round-trip as ISO strings,
  - unsupported `schedulingSchemaVersion`, wrong library major, invalid state, NaN/negative scheduling numbers, or malformed dates reject without fallback.

- [ ] **Step 3: Run adapter tests and confirm RED**

Run: `npm test -- src/review/fsrsAdapter.test.ts`  
Expected: FAIL because adapter does not exist.

- [ ] **Step 4: Implement the adapter**

Use `createEmptyCard`, `fsrs`, `Rating`, and `State` only inside the adapter. Convert date objects to ISO strings in storage and restore them when invoking the library.

- [ ] **Step 5: Run Task 2 tests and typecheck**

Run: `npm test -- src/review/fsrsAdapter.test.ts && npm run typecheck`  
Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `feat: add fsrs scheduling adapter`

### Task 3: Dexie v3, Review Settings Persistence, and Review Inventory Reads

**Files:**
- Modify: `src/persistence/db.ts`
- Modify: `src/training/repositories.ts`
- Modify: `src/persistence/dexieTrainingRepository.ts`
- Create: `src/persistence/reviewRepository.test.ts`
- Modify: `src/persistence/dexieTrainingRepository.test.ts`

**Interfaces:**
- Produces database schema v3 with `repertoireMoveMastery.nextReviewAt` indexed.
- Produces: `TrainingRepository.updateReviewSettings(settings: ReviewSettings): Promise<LearnerProfile>`
- Produces: `TrainingRepository.loadReviewInventory(filterRepertoireId?: EntityId): Promise<ReviewInventory>`
- Produces: `TrainingRepository.countNewReviewIntroductions(startIso: string, endIso: string): Promise<number>`
- `ReviewInventory` returns active repertoire targets with position, preferred move/edge, accepted alternatives, target mastery, opening depth/order, and prior scheduling-applied attempt count.

- [ ] **Step 1: Write failing migration/index test**

Open a v2-shaped fake IndexedDB, upgrade through `ChessTrainingDatabase`, and assert database version 3 preserves existing rows and exposes the `nextReviewAt` index.

- [ ] **Step 2: Run migration test and confirm RED**

Run: `npm test -- src/persistence/dexieTrainingRepository.test.ts`  
Expected: FAIL on v3 expectation.

- [ ] **Step 3: Implement `V3_STORES` and database version 3**

Do not transform existing records; absent/null schedules remain valid.

- [ ] **Step 4: Write failing settings/inventory tests**
  - settings update persists and returns normalized values,
  - missing settings read as defaults,
  - archived repertoires are excluded,
  - one trainable position resolves exactly one preferred target,
  - accepted alternatives are attached but not separate targets,
  - malformed repertoire with zero/multiple preferred learner moves rejects,
  - due scheduled target and unscheduled target are both represented distinctly,
  - prior scheduled review count ignores relearning and unscheduled practice,
  - introduction count includes only `review.newCard === true` in `[startIso,endIso)`.

- [ ] **Step 5: Run review repository tests and confirm RED**

Run: `npm test -- src/persistence/reviewRepository.test.ts`  
Expected: FAIL on missing repository methods.

- [ ] **Step 6: Implement settings, inventory, and daily-count repository methods**

Use the new due index for scheduled due reads; preserve deterministic ordering in returned inventory.

- [ ] **Step 7: Run Task 3 tests**

Run: `npm test -- src/persistence/dexieTrainingRepository.test.ts src/persistence/reviewRepository.test.ts`  
Expected: PASS.

- [ ] **Step 8: Commit**

Commit message: `feat: persist adaptive review inventory`

### Task 4: Atomic Scheduled Review Persistence

**Files:**
- Modify: `src/training/repositories.ts`
- Modify: `src/persistence/dexieTrainingRepository.ts`
- Modify: `src/persistence/errors.ts`
- Create: `src/persistence/scheduledAttemptRecording.test.ts`

**Interfaces:**
- Produces: `RecordScheduledAttemptInput`
- Produces: `TrainingRepository.recordScheduledAttempt(input: RecordScheduledAttemptInput): Promise<TrainingAttempt>`
- Produces: `ReviewScheduleConflictError`
- Input carries stable `attemptId`, review metadata, expected target mastery revision, and next `ScheduledReviewResult`.

- [ ] **Step 1: Write failing scheduled-persistence tests**
  - new preferred-target review atomically creates attempt + target schedule,
  - accepted alternative stores alternative as `repertoireMoveId` while schedule is written to preferred target and rating is Hard,
  - wrong corrected preferred stores `correct: false` and target schedule,
  - same `attemptId` retry returns existing attempt and does not advance/overwrite schedule,
  - a different attempt with stale expected target revision throws `ReviewScheduleConflictError`,
  - simulated transaction failure leaves attempt and schedule unchanged,
  - `schedulingApplied: false` relearning records history but does not mutate target schedule,
  - ordinary `recordAttempt` still preserves existing scheduling fields unchanged.

- [ ] **Step 2: Run test and confirm RED**

Run: `npm test -- src/persistence/scheduledAttemptRecording.test.ts`  
Expected: FAIL on missing scheduled persistence operation.

- [ ] **Step 3: Implement scheduled persistence transaction**

Validate target preferred move belongs to the attempt repertoire and originates from the attempted position. Check idempotent attempt ID before stale-revision validation.

- [ ] **Step 4: Run Task 4 tests plus existing attempt tests**

Run: `npm test -- src/persistence/scheduledAttemptRecording.test.ts src/persistence/attemptRecording.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: record scheduled reviews atomically`

### Task 5: Backup V2 with V1 Restore Compatibility

**Files:**
- Modify: `src/training/types.ts`
- Modify: `src/training/repositories.ts`
- Modify: `src/persistence/backupSchema.ts`
- Modify: `src/persistence/backup.ts`
- Modify: `src/persistence/db.ts`
- Modify: `src/persistence/dexieTrainingAdminRepository.ts`
- Modify: `src/services/trainingDataService.ts`
- Modify: `src/persistence/backupTestUtils.ts`
- Modify: `src/persistence/backupSchema.test.ts`
- Modify: `src/persistence/backup.test.ts`

**Interfaces:**
- Produces: `TrainingBackupV2`
- Produces: `TrainingBackup = TrainingBackupV1 | TrainingBackupV2`
- `parseAndValidateBackup(input: unknown): TrainingBackup`
- New export methods return V2.
- Restore and pre-restore backup methods accept/return the union.

- [ ] **Step 1: Write failing V2 schema tests**
  - V2 accepts review settings, review attempt metadata, and valid scheduling envelopes,
  - invalid review target references reject,
  - scheduling envelope validation delegates to Task 2 parser,
  - unsupported future backup versions reject.

- [ ] **Step 2: Write failing V1 compatibility test**

Restore an unchanged V1 fixture and assert review settings resolve to defaults while schedules remain null.

- [ ] **Step 3: Run backup tests and confirm RED**

Run: `npm test -- src/persistence/backupSchema.test.ts src/persistence/backup.test.ts`  
Expected: FAIL on V2 behavior.

- [ ] **Step 4: Implement V2 export/validation/restore and backup union**

Keep `LocalBackupRecord.backup` compatible with either version. New exports emit `version: 2`.

- [ ] **Step 5: Run backup and data-service tests**

Run: `npm test -- src/persistence/backupSchema.test.ts src/persistence/backup.test.ts src/services/trainingDataService.test.ts`  
Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `feat: add adaptive review backup format`

### Task 6: Global Due Queue and Review Service

**Files:**
- Create: `src/review/queue.ts`
- Create: `src/review/queue.test.ts`
- Create: `src/services/reviewTrainingService.ts`
- Create: `src/services/reviewTrainingService.test.ts`
- Modify: `src/persistence/browserRepository.ts`

**Interfaces:**
- Consumes: `ReviewInventory`, settings, and Task 2 scheduler.
- Produces: `ReviewCard`
- Produces: `ReviewOverview { dueCount; newAvailable; settings }`
- Produces: `ReviewSessionPlan { cards; remainingAfterBatch; settings }`
- Produces: `buildReviewQueue(input: BuildReviewQueueInput): ReviewSessionPlan`
- Produces: `ReviewTrainingService.getOverview(input): Promise<ReviewOverview>`
- Produces: `ReviewTrainingService.updateSettings(settings): Promise<ReviewSettings>`
- Produces: `ReviewTrainingService.startSession(input): Promise<ReviewTrainingEngine>`
- Clock input includes an injected wall-clock `now(): Date` and local-day-boundary function for deterministic tests.

- [ ] **Step 1: Write failing queue tests**
  - due cards sort by earliest `nextReviewAt`,
  - all due cards outrank new cards,
  - unique batch size caps initial targets at configured size,
  - 65 due with batch 15 reports remaining inventory without changing dates,
  - new cards stop at remaining daily allowance,
  - new cards round-robin across active repertoires,
  - within repertoire: lower depth, then source order, then stable ID,
  - optional repertoire filter affects queue only, not records,
  - zero new-items/day still serves due cards.

- [ ] **Step 2: Run queue tests and confirm RED**

Run: `npm test -- src/review/queue.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement pure queue builder**

Keep queue selection deterministic and side-effect free.

- [ ] **Step 4: Write failing service tests**
  - overview returns due/new counts,
  - local day boundaries count only today's durable new introductions,
  - crossing local midnight resets allowance based on injected boundaries,
  - settings update persists normalized values,
  - session creation creates a global session plan and does not mutate schedules.

- [ ] **Step 5: Run service tests and confirm RED**

Run: `npm test -- src/services/reviewTrainingService.test.ts`  
Expected: FAIL.

- [ ] **Step 6: Implement review service and browser runtime composition**

Expose `getBrowserReviewTrainingService()`.

- [ ] **Step 7: Run Task 6 tests**

Run: `npm test -- src/review/queue.test.ts src/services/reviewTrainingService.test.ts`  
Expected: PASS.

- [ ] **Step 8: Commit**

Commit message: `feat: build global due review queue`

### Task 7: Review Training Engine and Relearning

**Files:**
- Create: `src/review/engine.ts`
- Create: `src/review/engine.test.ts`
- Create: `src/review/engine.concurrent.test.ts`

**Interfaces:**
- Consumes: `ReviewSessionPlan`, `TrainingRepository.recordScheduledAttempt`, `FsrsScheduler`, and `gradeReview`.
- Produces: `ReviewTrainingState`
- Produces: `ReviewTrainingEngine.start(options): Promise<ReviewTrainingEngine>`
- Methods: `state()`, `requestHint()`, `submitMove(move)`, `retryPersistence()`, `stop()`.
- State exposes current repertoire name, learner side, FEN, prompt phase, unique progress, feedback, completion summary, and whether more inventory exists.

- [ ] **Step 1: Write failing core engine tests**
  - mixed White/Black cards switch orientation metadata and repertoire name,
  - preferred first response computes automatic rating and applies schedule,
  - accepted alternative resolves immediately as Hard and schedules preferred target,
  - wrong first response becomes Again, enters correction, and requires preferred move before resolution,
  - hint makes scheduled grade Again,
  - persistence failure holds `resolved-not-persisted` and retry reuses stable attempt ID,
  - concurrent submit while persistence is in flight cannot record twice.

- [ ] **Step 2: Run engine tests and confirm RED**

Run: `npm test -- src/review/engine.test.ts src/review/engine.concurrent.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement core review state machine**

Use injected monotonic `nowMs()` for decision timing and relearning gates; use injected wall-clock `nowDate()` for durable timestamps and scheduling.

- [ ] **Step 4: Write failing relearning tests**
  - Again queues one relearning entry,
  - entry is not eligible before three intervening prompts,
  - entry is not eligible before 120 seconds,
  - eligible entry can appear after both gates,
  - relearning persists `kind: relearning` and `schedulingApplied: false`,
  - successful relearning does not replace the original Again schedule,
  - when unique cards finish before relearning becomes eligible, session completes without waiting or immediate repetition.

- [ ] **Step 5: Run relearning tests and confirm RED**

Run: `npm test -- src/review/engine.test.ts`  
Expected: FAIL on relearning assertions.

- [ ] **Step 6: Implement relearning queue and session summary**

Batch progress counts unique scheduled targets; reinforcement prompts may exceed that count.

- [ ] **Step 7: Run Task 7 tests**

Run: `npm test -- src/review/engine.test.ts src/review/engine.concurrent.test.ts`  
Expected: PASS.

- [ ] **Step 8: Commit**

Commit message: `feat: add adaptive review session engine`

### Task 8: Review Due UI and Train Integration

**Files:**
- Create: `src/components/ReviewTrainer.tsx`
- Create: `src/components/ReviewTrainer.test.tsx`
- Create: `src/components/ReviewTrainer.lifecycle.test.tsx`
- Modify: `src/components/OpeningTrainingHome.tsx`
- Modify: `src/components/OpeningTrainingHome.test.tsx`
- Modify: `src/components/OpeningTrainingPage.tsx`
- Modify: `src/openingTraining.css`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

**Interfaces:**
- `ReviewTrainer { service?: ReviewTrainingService; repertoireId?: EntityId; onExit(): void }`
- Opening home loads review overview, renders `N due · M new available`, settings, global Review Due start, and optional repertoire filter.
- Opening page adds `{ kind: 'review'; repertoireId?: EntityId }` view without changing Practice Line/Quick Recall launch shape.

- [ ] **Step 1: Write failing home tests**
  - Review Due inventory appears,
  - global start works with no repertoire filter,
  - filter can choose one repertoire,
  - new-items/day and batch-size settings initialize from service and persist changes,
  - invalid settings are not submitted.

- [ ] **Step 2: Run home tests and confirm RED**

Run: `npm test -- src/components/OpeningTrainingHome.test.tsx`  
Expected: FAIL.

- [ ] **Step 3: Implement Review Due controls on training home**

Update Phase 3 copy to Phase 4 without changing Train/Play/Data navigation.

- [ ] **Step 4: Write failing ReviewTrainer tests**
  - controlled board uses current card FEN and learner orientation,
  - mixed repertoire label updates,
  - click/drag/promotion moves submit,
  - hint, feedback, retry-save, session completion summary, and Continue Reviewing render correctly,
  - unmount/late-start cleanup calls `stop()` exactly once.

- [ ] **Step 5: Run ReviewTrainer tests and confirm RED**

Run: `npm test -- src/components/ReviewTrainer.test.tsx src/components/ReviewTrainer.lifecycle.test.tsx`  
Expected: FAIL.

- [ ] **Step 6: Implement ReviewTrainer and page wiring**

Reuse Phase 3 board interaction patterns without coupling Review Due to `OpeningTrainingEngine`.

- [ ] **Step 7: Add responsive styles and App integration tests**

At 320px, controls and board container must fit without horizontal overflow.

- [ ] **Step 8: Run Task 8 tests**

Run: `npm test -- src/components/OpeningTrainingHome.test.tsx src/components/ReviewTrainer.test.tsx src/components/ReviewTrainer.lifecycle.test.tsx src/App.test.tsx`  
Expected: PASS.

- [ ] **Step 9: Commit**

Commit message: `feat: add review due training interface`

### Task 9: Browser E2E, Documentation, and Full Verification

**Files:**
- Modify/Create: `src/e2e/opening-training.spec.ts` or the existing Phase 3 opening E2E file
- Modify: `README.md`
- Modify only if needed: `.github/workflows/ci.yml`

**Interfaces:**
- No new production interfaces.
- Documents Phase 4 behavior, backup V2, local-only persistence, and Review Due defaults.

- [ ] **Step 1: Write/extend failing Playwright scenarios**
  - Review Due appears on Train,
  - introduce a new card and verify schedule survives reload,
  - a due card remains scheduled across reload,
  - mixed White/Black review changes board orientation,
  - accepted alternative reports correct-but-preferred behavior,
  - failed recall produces delayed relearning using deterministic test time hooks where necessary,
  - changed review settings survive reload,
  - 320px viewport has no horizontal overflow.

- [ ] **Step 2: Run E2E and confirm RED for new Phase 4 assertions**

Run: `npm run build && npm run test:e2e`  
Expected: existing scenarios pass; new Phase 4 assertions fail until final integration gaps are fixed.

- [ ] **Step 3: Fix only integration defects exposed by E2E**

Do not add new product scope.

- [ ] **Step 4: Update README**

Describe Review Due, automatic grading, default 10 new/day, default 15-card batches, local-only scheduling, backup V2/V1 restore, and scope exclusions.

- [ ] **Step 5: Run full verification**

Run:
```bash
npm ci
npm test
npm run typecheck
npm run build
npm run test:e2e
```

Expected: all commands pass with zero test failures.

- [ ] **Step 6: Inspect dependency audit and production bundle warning**

Record any non-blocking warnings; do not silently expand scope to optimize unrelated bundle size.

- [ ] **Step 7: Commit**

Commit message: `docs: complete phase 4 adaptive review`

- [ ] **Step 8: Whole-branch review and PR**

Compare against the Phase 4 base commit `7f65e869046005bd62e97ab472fc4fcf73ef216c`, verify only Phase 4 scope changed, then open a PR with RED->GREEN evidence and exact-head CI results.
