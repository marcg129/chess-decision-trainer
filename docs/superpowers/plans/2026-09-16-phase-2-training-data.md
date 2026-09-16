# Phase 2 Training Data and Local Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a tested local training-data platform with transposition-aware canonical positions, multiple repertoires, layered mastery, append-only attempt history, IndexedDB persistence, and safe backup/restore utilities.

**Architecture:** Keep Phase 1 chess rules authoritative. Add a plain-TypeScript training domain, repository interfaces, and a Dexie persistence adapter; only persistence modules may access IndexedDB. Canonical chess positions and move edges are shared globally, while repertoire metadata and repertoire-specific mastery reference those canonical records.

**Tech Stack:** React 19, TypeScript 7, Vite 8, `chess.js` 1.4.0, Dexie 4.4.6, Zod 4.6.5, Vitest 5, Testing Library, `fake-indexeddb` 6.2.5, Playwright Test 1.63.0 using the CI system Chrome.

**Spec:** `docs/superpowers/specs/2026-09-16-phase-2-training-data-design.md`

## Global Constraints

- One local learner profile may own multiple repertoires.
- Repertoires use a shared canonical position graph; transpositions must converge on one `Position` record.
- `positionKey` is unique chess identity; stable UUIDs are application/database identity.
- The normalized position key includes en-passant only when a legal en-passant capture exists.
- Position mastery and repertoire-move mastery remain separate.
- Training attempts are append-only during normal operation.
- Attempt + mastery writes and graph/repertoire mutations are transactional.
- Dexie is the only module allowed to access IndexedDB directly.
- Backup format version is separate from Dexie schema version.
- Restore is replace-only, validates before mutation, creates a pre-restore backup, and is atomic.
- Imported move edges must be legal from the source representative FEN and must resolve to the referenced destination `positionKey`.
- Reset preserves the IndexedDB database/schema and recreates a clean local learner state.
- Phase 2 must not add opening drills, repertoire-authoring workflow, FSRS, Stockfish, accounts, cloud sync, or merge/conflict resolution.

## File Structure

- `src/core/positionIdentity.ts` — corrected normalized position identity.
- `src/training/types.ts` — durable plain-TypeScript training entities and input types.
- `src/training/repositories.ts` — storage-agnostic repository contracts.
- `src/training/graph.ts` — pure chess transition derivation/validation.
- `src/training/mastery.ts` — non-adaptive aggregate mastery/stat updates.
- `src/persistence/db.ts` — Dexie database/table declarations, indexes, versions, migrations.
- `src/persistence/errors.ts` — typed persistence/application errors.
- `src/persistence/dexieTrainingRepository.ts` — repository implementation and transactions.
- `src/persistence/backupSchema.ts` — Zod schemas and semantic backup validation.
- `src/persistence/backup.ts` — export, pre-restore snapshot, atomic restore, reset.
- `src/services/trainingDataService.ts` — UI-facing summary/admin facade; no raw Dexie exposure.
- `src/components/TrainingDataPanel.tsx` — minimal Phase 2 inspect/export/import/reset UI.
- `src/e2e/persistence.spec.ts` — real-browser IndexedDB reload smoke.
- `playwright.config.ts` — Playwright configured to use system Chrome and Vite preview.
- `.github/workflows/ci.yml` — run feature/main branch CI and browser persistence smoke.
- Tests live beside the modules they cover; persistence tests import `fake-indexeddb/auto` and use unique database names.

---

### Task 1: Correct normalized en-passant position identity

**Files:**
- Modify: `src/core/positionIdentity.ts`
- Modify: `src/core/positionIdentity.test.ts`

**Interfaces:**
- Produces: `positionKeyFromFen(fen: string): string` whose fourth field is the en-passant target only when a legal en-passant capture exists.

- [ ] **Step 1: Add failing regression tests**

```ts
import { positionKeyFromFen } from './positionIdentity';

test('preserves an effective legal en-passant target', () => {
  expect(positionKeyFromFen('8/8/8/2pP4/8/8/8/K6k w - c6 0 1')).toBe(
    '8/8/8/2pP4/8/8/8/K6k w - c6',
  );
});

test('normalizes an ineffective en-passant target to dash', () => {
  expect(positionKeyFromFen('8/8/8/2p5/8/8/8/K6k w - c6 0 1')).toBe(
    '8/8/8/2p5/8/8/8/K6k w - -',
  );
});

test('normalizes a pseudo-available but illegal pinned en-passant capture', () => {
  expect(positionKeyFromFen('4r2k/8/8/3pP3/8/8/8/4K3 w - d6 0 1')).toBe(
    '4r2k/8/8/3pP3/8/8/8/4K3 w - -',
  );
});
```

Keep the existing counter-removal and malformed-input tests.

- [ ] **Step 2: Run the regression tests and verify RED**

Run: `npm test -- src/core/positionIdentity.test.ts`

Expected: the ineffective/pinned en-passant tests fail against the current first-four-fields implementation.

- [ ] **Step 3: Implement legal-en-passant normalization**

```ts
import { Chess } from 'chess.js';

export function positionKeyFromFen(fen: string): string {
  const fields = fen.trim().split(/\s+/);
  if (fields.length < 4) {
    throw new Error('Invalid FEN: expected at least four fields.');
  }

  const [placement, turn, castling, enPassant] = fields;
  const chess = new Chess(fen);
  const effectiveEnPassant =
    enPassant !== '-' &&
    chess.moves({ verbose: true }).some(
      (move) => move.flags.includes('e') && move.to === enPassant,
    )
      ? enPassant
      : '-';

  return `${placement} ${turn} ${castling} ${effectiveEnPassant}`;
}
```

- [ ] **Step 4: Run identity + chess-domain tests**

```bash
npm test -- src/core/positionIdentity.test.ts src/core/game.test.ts
```

Expected: PASS, including existing transposition tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/positionIdentity.ts src/core/positionIdentity.test.ts
git commit -m "fix: normalize ineffective en passant position keys"
```

---

### Task 2: Add Phase 2 dependencies, domain entities, and repository contracts

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `src/training/types.ts`
- Create: `src/training/repositories.ts`
- Create: `src/training/types.test.ts`

**Interfaces:**
- Produces stable entity types and repository interfaces consumed by every later Phase 2 task.
- No file in `src/training/` may import Dexie.

- [ ] **Step 1: Install pinned Phase 2 dependencies**

```bash
npm install dexie@4.4.6 zod@4.6.5
npm install --save-dev fake-indexeddb@6.2.5 @playwright/test@1.63.0
```

- [ ] **Step 2: Write failing type/domain construction tests**

Create `src/training/types.test.ts` that constructs one complete fixture and verifies UUID-shaped IDs and distinct mastery contexts:

```ts
import { createId } from './types';

test('creates stable UUID entity ids', () => {
  expect(createId()).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
});
```

- [ ] **Step 3: Define exact domain types in `src/training/types.ts`**

Use ISO timestamp strings and UUID strings:

```ts
export type EntityId = string;
export type IsoTimestamp = string;
export type RepertoireSide = 'white' | 'black' | 'mixed';
export type RepertoireMoveRole = 'learner' | 'opponent' | 'alternative';
export type MasteryState = 'new' | 'learning' | 'familiar' | 'mastered';

export type LearnerProfile = {
  id: EntityId;
  displayName: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
};

export type Position = {
  id: EntityId;
  positionKey: string;
  fen: string;
  sideToMove: 'w' | 'b';
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
};

export type MoveEdge = {
  id: EntityId;
  fromPositionId: EntityId;
  toPositionId: EntityId;
  moveKey: string;
  from: string;
  to: string;
  promotion?: 'q' | 'r' | 'b' | 'n';
  san: string;
  createdAt: IsoTimestamp;
};

export type Repertoire = {
  id: EntityId;
  learnerId: EntityId;
  name: string;
  side: RepertoireSide;
  description?: string;
  archived: boolean;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
};

export type RepertoirePosition = {
  id: EntityId;
  repertoireId: EntityId;
  positionId: EntityId;
  trainable: boolean;
  notes?: string;
  tags: string[];
  priority?: number;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
};

export type RepertoireMove = {
  id: EntityId;
  repertoireId: EntityId;
  moveEdgeId: EntityId;
  role: RepertoireMoveRole;
  preferred: boolean;
  order?: number;
  explanation?: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
};

export type PositionMastery = {
  id: EntityId;
  positionId: EntityId;
  attempts: number;
  correct: number;
  incorrect: number;
  averageDecisionTimeMs: number | null;
  lastSeenAt: IsoTimestamp | null;
  state: MasteryState;
  score: number;
  nextReviewAt: IsoTimestamp | null;
  schedulingData: Record<string, unknown> | null;
  updatedAt: IsoTimestamp;
};

export type RepertoireMoveMastery = {
  id: EntityId;
  repertoireMoveId: EntityId;
  attempts: number;
  correct: number;
  incorrect: number;
  streak: number;
  averageDecisionTimeMs: number | null;
  lastAttemptedAt: IsoTimestamp | null;
  state: MasteryState;
  score: number;
  nextReviewAt: IsoTimestamp | null;
  schedulingData: Record<string, unknown> | null;
  updatedAt: IsoTimestamp;
};

export type TrainingSession = {
  id: EntityId;
  repertoireId?: EntityId;
  mode: string;
  startedAt: IsoTimestamp;
  completedAt?: IsoTimestamp;
};

export type AttemptMasterySnapshot = {
  positionState: MasteryState;
  positionScore: number;
  repertoireMoveState?: MasteryState;
  repertoireMoveScore?: number;
};

export type TrainingAttempt = {
  id: EntityId;
  timestamp: IsoTimestamp;
  sessionId?: EntityId;
  repertoireId: EntityId;
  positionId: EntityId;
  repertoireMoveId?: EntityId;
  expectedMove: string;
  actualMove: string;
  correct: boolean;
  decisionTimeMs: number;
  hintCount: number;
  hintUsed: boolean;
  mode: string;
  masteryBefore: AttemptMasterySnapshot;
  masteryAfter: AttemptMasterySnapshot;
};

export const createId = (): EntityId => crypto.randomUUID();
```

- [ ] **Step 4: Define repository contracts in `src/training/repositories.ts`**

```ts
export type RepertoireTransitionInput = {
  repertoireId: EntityId;
  fromFen: string;
  move: { from: string; to: string; promotion?: 'q' | 'r' | 'b' | 'n' };
  role: RepertoireMoveRole;
  preferred: boolean;
  trainable: boolean;
};

export type RecordAttemptInput = Omit<TrainingAttempt, 'id' | 'masteryBefore' | 'masteryAfter'>;

export interface TrainingRepository {
  ensureLocalLearner(displayName?: string): Promise<LearnerProfile>;
  saveRepertoire(repertoire: Repertoire): Promise<void>;
  listRepertoires(learnerId: EntityId): Promise<Repertoire[]>;
  upsertRepertoireTransition(input: RepertoireTransitionInput): Promise<{
    fromPosition: Position;
    toPosition: Position;
    moveEdge: MoveEdge;
    repertoirePosition: RepertoirePosition;
    repertoireMove: RepertoireMove;
  }>;
  getPositionByKey(positionKey: string): Promise<Position | undefined>;
  getPositionMastery(positionId: EntityId): Promise<PositionMastery | undefined>;
  getRepertoireMoveMastery(repertoireMoveId: EntityId): Promise<RepertoireMoveMastery | undefined>;
  recordAttempt(input: RecordAttemptInput): Promise<TrainingAttempt>;
  createSession(session: TrainingSession): Promise<void>;
}
```

Add a separate admin interface so normal training code does not depend on destructive operations:

```ts
export interface TrainingAdminRepository {
  getSummary(): Promise<TrainingDataSummary>;
  exportBackup(): Promise<TrainingBackupV1>;
  restoreBackup(backup: TrainingBackupV1): Promise<void>;
  getLatestPreRestoreBackup(): Promise<TrainingBackupV1 | null>;
  resetTrainingData(): Promise<LearnerProfile>;
}
```

Define `TrainingDataSummary` and `TrainingBackupV1` in `types.ts`; `TrainingBackupV1` uses `format: 'chess-decision-trainer'` and `version: 1`.

- [ ] **Step 5: Run tests/typecheck**

```bash
npm test -- src/training/types.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/training/
git commit -m "feat: define phase 2 training domain contracts"
```

---

### Task 3: Implement canonical graph derivation and Dexie persistence schema

**Files:**
- Create: `src/training/graph.ts`, `src/training/graph.test.ts`
- Create: `src/persistence/db.ts`, `src/persistence/errors.ts`
- Create: `src/persistence/dexieTrainingRepository.ts`
- Create: `src/persistence/dexieTrainingRepository.test.ts`

**Interfaces:**
- Consumes: Phase 1 `positionKeyFromFen`, Phase 2 types/contracts.
- Produces: `deriveTransition(fromFen, move)` and `DexieTrainingRepository` implementing training repository operations.

- [ ] **Step 1: Write failing pure graph tests**

Test a legal transition and an illegal transition:

```ts
const result = deriveTransition(
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  { from: 'e2', to: 'e4' },
);
expect(result.san).toBe('e4');
expect(result.moveKey).toBe('e2e4');
expect(result.fromPositionKey).toContain(' w KQkq ');
expect(result.toPositionKey).toContain(' b KQkq ');
expect(() => deriveTransition(result.fromFen, { from: 'e2', to: 'e5' })).toThrow();
```

- [ ] **Step 2: Implement `deriveTransition`**

Use `Chess` to validate/apply the move, then return exact source/destination FEN and normalized keys:

```ts
export function deriveTransition(
  fromFen: string,
  moveInput: { from: string; to: string; promotion?: 'q' | 'r' | 'b' | 'n' },
) {
  const chess = new Chess(fromFen);
  const fromPositionKey = positionKeyFromFen(fromFen);
  const move = chess.move(moveInput);
  const toFen = chess.fen();
  return {
    fromFen,
    fromPositionKey,
    toFen,
    toPositionKey: positionKeyFromFen(toFen),
    moveKey: `${move.from}${move.to}${move.promotion ?? ''}`,
    from: move.from,
    to: move.to,
    promotion: move.promotion,
    san: move.san,
  };
}
```

Catch `chess.js` move errors and throw a domain `InvalidChessEdgeError` rather than exposing raw library errors.

- [ ] **Step 3: Write failing persistence tests using real IndexedDB semantics**

At the top of the test file:

```ts
import 'fake-indexeddb/auto';
```

Create each test database with `new ChessTrainingDatabase(`test-${crypto.randomUUID()}`)` and call `await db.delete()` in cleanup.

Required RED cases:
- `ensureLocalLearner()` is idempotent.
- two calls creating the same normalized position return one `Position` row.
- two different move orders reaching the same key reuse the same destination position.
- the same canonical move edge can be referenced by two repertoires.
- duplicate `(repertoireId, positionId)` and `(repertoireId, moveEdgeId)` relationships are reused, not duplicated.
- close/reopen the same database name and confirm records persist.

- [ ] **Step 4: Implement centralized Dexie schema**

`src/persistence/db.ts` defines typed tables and explicit versions. Use version 1 for core Phase 2 tables and version 2 to add `localBackups`, proving forward schema evolution without data deletion.

Required version-2 store definitions:

```ts
this.version(2).stores({
  learnerProfiles: '&id, updatedAt',
  repertoires: '&id, learnerId, [learnerId+archived], updatedAt',
  positions: '&id, &positionKey, sideToMove, updatedAt',
  moveEdges: '&id, &[fromPositionId+moveKey], fromPositionId, toPositionId',
  repertoirePositions: '&id, &[repertoireId+positionId], repertoireId, positionId',
  repertoireMoves: '&id, &[repertoireId+moveEdgeId], repertoireId, moveEdgeId, role',
  positionMastery: '&id, &positionId, lastSeenAt',
  repertoireMoveMastery: '&id, &repertoireMoveId, lastAttemptedAt',
  trainingSessions: '&id, repertoireId, startedAt',
  trainingAttempts: '&id, timestamp, repertoireId, positionId, sessionId',
  localBackups: '&id, createdAt, reason',
});
```

Version 1 contains all entries above except `localBackups`; do not delete/recreate stores during the upgrade.

- [ ] **Step 5: Implement graph/repertoire transaction**

`upsertRepertoireTransition` must:
1. call `deriveTransition` before the write transaction;
2. run one Dexie `rw` transaction over positions, edges, repertoirePositions, repertoireMoves;
3. get-or-create source/destination positions by unique `positionKey`;
4. get-or-create edge by `[fromPositionId+moveKey]`;
5. verify an existing edge's `toPositionId` matches the derived destination;
6. get-or-create repertoire membership/context records;
7. return all persisted records.

Translate `ConstraintError`, quota/storage failures, and transaction errors into typed errors from `src/persistence/errors.ts`.

- [ ] **Step 6: Add migration-preservation test**

Create a legacy database at schema version 1, insert a learner/repertoire record, close it, then open it through current `ChessTrainingDatabase`. Assert the record remains and the `localBackups` table exists.

- [ ] **Step 7: Run targeted persistence verification**

```bash
npm test -- src/training/graph.test.ts src/persistence/dexieTrainingRepository.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/training/graph* src/persistence/
git commit -m "feat: persist canonical repertoire graph with dexie"
```

---

### Task 4: Add layered mastery and atomic attempt recording

**Files:**
- Create: `src/training/mastery.ts`, `src/training/mastery.test.ts`
- Modify: `src/persistence/dexieTrainingRepository.ts`
- Modify: `src/persistence/dexieTrainingRepository.test.ts`

**Interfaces:**
- Produces pure non-adaptive aggregate update helpers and atomic `recordAttempt` behavior.

- [ ] **Step 1: Write failing mastery-stat tests**

Use one correct 1200ms attempt and one incorrect 2400ms attempt. Assert:
- attempts/correct/incorrect increments are exact;
- running average decision time is deterministic;
- correct increments repertoire streak, incorrect resets it to zero;
- Phase 2 does not invent FSRS scheduling; `state`, `score`, `nextReviewAt`, and `schedulingData` remain caller-controlled/default values.

- [ ] **Step 2: Implement pure aggregate helpers**

```ts
export function updateAverage(
  previousAverage: number | null,
  previousCount: number,
  value: number,
): number {
  if (previousAverage === null || previousCount === 0) return value;
  return (previousAverage * previousCount + value) / (previousCount + 1);
}
```

Add `nextPositionMastery(current, outcome, timestamp)` and `nextRepertoireMoveMastery(current, outcome, timestamp)` that update only counts, speed, timestamps, and streak; leave adaptive fields unchanged.

- [ ] **Step 3: Write failing atomic repository tests**

Seed learner, repertoire, position, move edge, repertoire move, and optional session. Call `recordAttempt` and assert in one successful result:
- one attempt appended;
- position mastery updated;
- repertoire-move mastery updated independently;
- attempt stores mastery before/after snapshots;
- session ID/context are preserved.

For rollback, call `recordAttempt` with a nonexistent `repertoireMoveId`. Arrange repository code so the attempt insert occurs inside the transaction before the missing repertoire-move check raises. After rejection, assert attempts and both mastery tables are unchanged.

- [ ] **Step 4: Implement `recordAttempt` transaction**

Run one Dexie `rw` transaction over attempts + both mastery tables (+ sessions when referenced). Validate all IDs within the transaction, compute before snapshots, append exactly one immutable attempt, update position mastery, update repertoire-move mastery only when a context ID exists, then return the stored attempt.

Reject negative decision time, negative hint count, missing repertoire/position/session/context IDs, or a context record belonging to a different repertoire.

- [ ] **Step 5: Verify mastery separation and rollback**

```bash
npm test -- src/training/mastery.test.ts src/persistence/dexieTrainingRepository.test.ts
```

Expected: PASS with explicit assertions that shared position mastery is not copied into repertoire-specific mastery.

- [ ] **Step 6: Commit**

```bash
git add src/training/mastery* src/persistence/dexieTrainingRepository*
git commit -m "feat: record atomic training attempts and mastery"
```

---

### Task 5: Implement validated versioned backup, restore, pre-restore recovery, and reset

**Files:**
- Create: `src/persistence/backupSchema.ts`, `src/persistence/backupSchema.test.ts`
- Create: `src/persistence/backup.ts`, `src/persistence/backup.test.ts`
- Modify: `src/persistence/dexieTrainingRepository.ts`

**Interfaces:**
- Produces: `parseAndValidateBackup(input: unknown): TrainingBackupV1` and admin repository methods.

- [ ] **Step 1: Define failing runtime-schema tests**

Required invalid cases:
- wrong `format`;
- unsupported `version`;
- malformed UUID;
- duplicate UUID;
- duplicate `positionKey`;
- missing repertoire/position/move references;
- move edge illegal from source FEN;
- legal move edge whose derived destination key differs from referenced destination.

A valid small backup must parse successfully.

- [ ] **Step 2: Implement Zod structural schema**

Top-level exact contract:

```ts
export const BACKUP_FORMAT = 'chess-decision-trainer' as const;
export const BACKUP_VERSION = 1 as const;

export type TrainingBackupV1 = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  schemaVersion: number;
  data: {
    learnerProfiles: LearnerProfile[];
    repertoires: Repertoire[];
    positions: Position[];
    moveEdges: MoveEdge[];
    repertoirePositions: RepertoirePosition[];
    repertoireMoves: RepertoireMove[];
    positionMastery: PositionMastery[];
    repertoireMoveMastery: RepertoireMoveMastery[];
    trainingSessions: TrainingSession[];
    trainingAttempts: TrainingAttempt[];
  };
};
```

Use `z.string().uuid()` for entity IDs and strict enums for side/role/mastery state.

- [ ] **Step 3: Implement semantic validation after Zod parse**

Build maps/sets for IDs and position keys; reject duplicates and broken references. For every `MoveEdge`, locate source/destination positions and call `deriveTransition(source.fen, edge move)`. Require derived source key to equal source `positionKey`, derived `moveKey` to equal stored `moveKey`, and derived destination key to equal destination `positionKey`.

Return typed `InvalidBackupError`, `UnsupportedBackupVersionError`, `ReferentialIntegrityError`, or `InvalidChessEdgeError`.

- [ ] **Step 4: Write failing export/restore/reset integration tests**

Verify:
1. seed data → export → reset/clear → restore → export again yields the same logical dataset after ignoring `exportedAt` and pre-restore maintenance rows;
2. invalid backup changes zero user-data rows;
3. unsupported backup changes zero rows;
4. forced failure during restore rolls back the clearing/inserts;
5. successful restore leaves a downloadable pre-restore backup;
6. reset clears all user/training tables, preserves database version, and recreates one clean local learner.

- [ ] **Step 5: Implement backup/export/restore helpers**

`exportBackup` reads all user tables in a read transaction and emits `format/version/exportedAt/schemaVersion/data`.

`restoreBackup` sequence:
1. `parseAndValidateBackup` before opening a write transaction;
2. export current dataset and store it in `localBackups` with `reason: 'pre-restore'`;
3. start one `rw` transaction covering every replaceable user-data table;
4. clear those tables;
5. `bulkAdd` imported records preserving IDs;
6. run final count/reference checks inside the same transaction;
7. commit or throw so Dexie rolls back.

`localBackups` is maintenance data and is not cleared by restore/reset.

- [ ] **Step 6: Run backup tests**

```bash
npm test -- src/persistence/backupSchema.test.ts src/persistence/backup.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/persistence/
git commit -m "feat: add safe versioned training data backup restore"
```

---

### Task 6: Add UI-facing training-data service and summaries

**Files:**
- Create: `src/services/trainingDataService.ts`
- Create: `src/services/trainingDataService.test.ts`
- Create: `src/persistence/browserRepository.ts`

**Interfaces:**
- Produces one browser singleton/factory used by React without exposing Dexie.

- [ ] **Step 1: Write failing service tests**

Seed one learner, two repertoires, shared graph records, one attempt, and mastery. Assert `getSummary()` returns:

```ts
{
  learner: expect.objectContaining({ displayName: expect.any(String) }),
  repertoires: expect.arrayContaining([
    expect.objectContaining({ name: expect.any(String) }),
  ]),
  counts: {
    repertoires: 2,
    positions: expect.any(Number),
    moveEdges: expect.any(Number),
    positionMastery: 1,
    repertoireMoveMastery: 1,
    sessions: expect.any(Number),
    attempts: 1,
  },
  lastActivityAt: expect.any(String),
  schemaVersion: 2,
}
```

Also verify a fresh database auto-creates exactly one local learner and zero repertoires.

- [ ] **Step 2: Implement `TrainingDataService`**

Expose:

```ts
export class TrainingDataService {
  constructor(
    private readonly training: TrainingRepository,
    private readonly admin: TrainingAdminRepository,
  ) {}

  initialize(): Promise<TrainingDataSummary>;
  refreshSummary(): Promise<TrainingDataSummary>;
  exportBackup(): Promise<TrainingBackupV1>;
  validateBackup(input: unknown): TrainingBackupV1;
  restoreBackup(backup: TrainingBackupV1): Promise<TrainingDataSummary>;
  getPreRestoreBackup(): Promise<TrainingBackupV1 | null>;
  reset(): Promise<TrainingDataSummary>;
}
```

`initialize` calls `ensureLocalLearner('Local learner')` then returns summary.

- [ ] **Step 3: Add browser repository factory**

`src/persistence/browserRepository.ts` constructs one `ChessTrainingDatabase('chess-decision-trainer')`, one `DexieTrainingRepository`, and one `TrainingDataService`. Export a getter rather than the raw database object so UI code cannot call tables directly.

- [ ] **Step 4: Verify service behavior**

```bash
npm test -- src/services/trainingDataService.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/ src/persistence/browserRepository.ts
git commit -m "feat: add training data admin service"
```

---

### Task 7: Add the minimal Training Data utility UI

**Files:**
- Create: `src/components/TrainingDataPanel.tsx`
- Create: `src/components/TrainingDataPanel.test.tsx`
- Modify: `src/App.tsx`, `src/App.test.tsx`, `src/styles.css`

**Interfaces:**
- `TrainingDataPanel` accepts an injectable `service?: TrainingDataService` test seam; production uses the browser service getter.

- [ ] **Step 1: Write failing component tests**

Required UI behaviors:
- summary shows learner, repertoire list, counts, schema version, and last activity;
- Export creates a JSON `Blob` and triggers a download filename beginning `chess-decision-trainer-backup-`;
- invalid selected JSON shows a validation error and no restore confirmation;
- valid selected backup shows repertoire/position/attempt counts before replacement;
- Restore button requires a second explicit confirmation before calling `restoreBackup`;
- Reset requires explicit confirmation before calling `reset`;
- successful restore refreshes visible counts;
- if a pre-restore backup exists, `Download pre-restore backup` appears;
- service failures render an understandable `role="alert"` message and do not crash the chess board.

Use a fake `TrainingDataService` object in UI tests; do not mock Dexie itself in component tests.

- [ ] **Step 2: Implement file parsing/download helpers inside the component module**

Read selected files with `await file.text()` and `JSON.parse`. Generate exports with:

```ts
const blob = new Blob([JSON.stringify(backup, null, 2)], {
  type: 'application/json',
});
const url = URL.createObjectURL(blob);
```

Create/click a temporary `<a download>` and revoke the URL immediately afterward.

- [ ] **Step 3: Implement the Phase 2 utility surface**

Keep it deliberately small:
- heading `Training data`;
- active learner label;
- repertoire names/counts;
- stored totals;
- schema version;
- Export backup;
- file input labeled `Restore backup`;
- parsed backup summary;
- explicit `Replace local data` confirmation control;
- pre-restore backup download when present;
- reset confirmation.

Do not add repertoire editing, opening practice, graphs, or mastery-dashboard visuals.

- [ ] **Step 4: Integrate into `App` without coupling chess state to persistence**

Render `<TrainingDataPanel />` beneath the existing game layout. Keep the existing `ChessGame`, clock, and telemetry state unchanged. Update the eyebrow copy to `Phase 2 · Local training data` while retaining all Phase 1 functionality.

- [ ] **Step 5: Add responsive styles**

Reuse existing panel primitives. Ensure file inputs/buttons wrap cleanly at ~320px, long repertoire names wrap, and no backup status text creates horizontal page scrolling.

- [ ] **Step 6: Run UI + existing regression suite**

```bash
npm test -- src/components/TrainingDataPanel.test.tsx src/App.test.tsx
npm test
npm run typecheck
npm run build
```

Expected: all Phase 1 and Phase 2 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/TrainingDataPanel* src/App.tsx src/App.test.tsx src/styles.css
git commit -m "feat: add local training data management ui"
```

---

### Task 8: Add real-browser persistence smoke, CI coverage, documentation, and final verification

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `playwright.config.ts`
- Create: `src/e2e/persistence.spec.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`

**Interfaces:**
- Produces `npm run test:e2e` using system Chrome against Vite preview.

- [ ] **Step 1: Add Playwright script/config**

Add:

```json
{
  "scripts": {
    "test:e2e": "playwright test"
  }
}
```

`playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './src/e2e',
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    channel: 'chrome',
    headless: true,
  },
  webServer: {
    command: 'npm exec -- vite preview --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
  },
});
```

- [ ] **Step 2: Write the browser persistence smoke**

Use the real UI restore flow rather than a hidden seed API. Construct a valid minimal backup in the test, upload it through the `Restore backup` file input, confirm replacement, assert the visible repertoire/position count, call `page.reload()`, and assert the same counts/repertoire name remain.

Core assertions:

```ts
await expect(page.getByText('Persistence Smoke Repertoire')).toBeVisible();
await page.reload();
await expect(page.getByText('Persistence Smoke Repertoire')).toBeVisible();
```

Also export after reload and assert the download is valid JSON with `format === 'chess-decision-trainer'` and `version === 1`.

- [ ] **Step 3: Fix CI branch filter and add persistence smoke**

Change workflow triggers from the stale Phase 1-only push branch to:

```yaml
on:
  push:
    branches:
      - main
      - 'feature/**'
  pull_request:
```

Keep `npm ci`, unit tests, typecheck, build, and existing screenshot smoke. Add after build:

```yaml
- name: Browser persistence smoke
  run: npm run test:e2e
```

Do not run `playwright install`; config uses the already-available system `google-chrome` channel.

- [ ] **Step 4: Update README**

Document:
- Phase 2 adds IndexedDB/Dexie local persistence, shared transposition-aware graph, multiple repertoires, layered mastery, attempt history, and backup/restore utilities;
- local data remains browser-local and is not cloud-synced;
- backup restore replaces current local training data after validation;
- current verification commands include `npm run test:e2e`;
- opening training UI, FSRS, Stockfish, accounts, and sync remain deferred.

- [ ] **Step 5: Clean-install final verification**

```bash
rm -rf node_modules dist
npm ci
npm test
npm run typecheck
npm run build
npm run test:e2e
```

Expected: every command exits successfully with zero failed tests.

- [ ] **Step 6: Run final acceptance audit against the spec**

Confirm explicitly:
- ineffective en-passant identity fixed;
- canonical transpositions deduplicate;
- canonical move edges are legal and destination-consistent;
- multiple repertoires share canonical graph records;
- layered mastery is distinct;
- attempt/mastery and graph writes are atomic;
- schema upgrade preserves records;
- browser reload preserves data;
- export/restore round-trip works;
- corrupt/unsupported/semantically invalid restore leaves data unchanged;
- pre-restore backup exists after replacement;
- reset preserves schema and recreates one learner;
- UI contains no Phase 3 trainer/editor features.

- [ ] **Step 7: Commit final verification/docs changes only after green evidence**

```bash
git add package.json package-lock.json playwright.config.ts src/e2e/ .github/workflows/ci.yml README.md
git commit -m "test: verify phase 2 local persistence"
```

If verification exposes defects, fix them under the same red/green discipline before committing. Do not mark Phase 2 complete from code inspection alone.
