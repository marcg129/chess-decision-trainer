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

- `src/core/positionIdentity.ts` — corrected normalized training-position identity.
- `src/training/types.ts` — durable plain-TypeScript training entities, summaries, and backup envelope type.
- `src/training/repositories.ts` — storage-agnostic normal/admin repository contracts.
- `src/training/graph.ts` — pure chess transition derivation/validation.
- `src/training/mastery.ts` — non-adaptive aggregate mastery/stat updates.
- `src/persistence/db.ts` — Dexie table declarations, indexes, schema versions, migrations.
- `src/persistence/errors.ts` — typed persistence/application failures.
- `src/persistence/dexieTrainingRepository.ts` — repository implementation and graph/attempt transactions.
- `src/persistence/backupSchema.ts` — Zod runtime schemas plus referential/chess-semantic validation.
- `src/persistence/backup.ts` — export, pre-restore snapshot, atomic restore, reset helpers.
- `src/persistence/browserRepository.ts` — browser singleton composition without exporting raw Dexie tables.
- `src/services/trainingDataService.ts` — UI-facing admin/summary facade.
- `src/components/TrainingDataPanel.tsx` — minimal inspect/export/import/reset UI.
- `src/e2e/persistence.spec.ts` — real-browser IndexedDB reload smoke.
- `playwright.config.ts` — Playwright system-Chrome/Vite-preview configuration.
- `.github/workflows/ci.yml` — clean install, tests, build, browser persistence smoke, screenshot smoke.
- Tests live beside modules; persistence tests use `fake-indexeddb/auto` and unique database names.

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

- [ ] **Step 4: Verify identity and existing chess-domain behavior**

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

### Task 2: Add dependencies, domain entities, summaries, backup type, and repository contracts

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `src/training/types.ts`
- Create: `src/training/repositories.ts`
- Create: `src/training/types.test.ts`

**Interfaces:**
- Produces every stable Phase 2 entity/type used by later tasks.
- No file in `src/training/` may import Dexie.

- [ ] **Step 1: Install pinned Phase 2 dependencies**

```bash
npm install dexie@4.4.6 zod@4.6.5
npm install --save-dev fake-indexeddb@6.2.5 @playwright/test@1.63.0
```

- [ ] **Step 2: Write the first failing domain test**

```ts
import { createId } from './types';

test('creates RFC 4122 version-4 UUID entity ids', () => {
  expect(createId()).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
});
```

- [ ] **Step 3: Define exact entity types in `src/training/types.ts`**

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

export type RepertoireSummary = {
  id: EntityId;
  name: string;
  side: RepertoireSide;
  archived: boolean;
  positions: number;
  moves: number;
  attempts: number;
};

export type TrainingDataSummary = {
  learner: LearnerProfile;
  repertoires: RepertoireSummary[];
  counts: {
    repertoires: number;
    positions: number;
    moveEdges: number;
    positionMastery: number;
    repertoireMoveMastery: number;
    sessions: number;
    attempts: number;
  };
  lastActivityAt: IsoTimestamp | null;
  schemaVersion: number;
};

export type TrainingBackupV1 = {
  format: 'chess-decision-trainer';
  version: 1;
  exportedAt: IsoTimestamp;
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

export const createId = (): EntityId => crypto.randomUUID();
```

- [ ] **Step 4: Define exact repository contracts in `src/training/repositories.ts`**

```ts
export type RepertoireTransitionInput = {
  repertoireId: EntityId;
  fromFen: string;
  move: { from: string; to: string; promotion?: 'q' | 'r' | 'b' | 'n' };
  role: RepertoireMoveRole;
  preferred: boolean;
  trainable: boolean;
};

export type RecordAttemptInput = Omit<
  TrainingAttempt,
  'id' | 'masteryBefore' | 'masteryAfter'
>;

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
  getRepertoireMoveMastery(
    repertoireMoveId: EntityId,
  ): Promise<RepertoireMoveMastery | undefined>;
  recordAttempt(input: RecordAttemptInput): Promise<TrainingAttempt>;
  createSession(session: TrainingSession): Promise<void>;
}

export interface TrainingAdminRepository {
  getSummary(): Promise<TrainingDataSummary>;
  exportBackup(): Promise<TrainingBackupV1>;
  restoreBackup(backup: TrainingBackupV1): Promise<void>;
  getLatestPreRestoreBackup(): Promise<TrainingBackupV1 | null>;
  resetTrainingData(): Promise<LearnerProfile>;
}
```

- [ ] **Step 5: Run test/typecheck**

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

### Task 3: Implement canonical graph derivation and Dexie schema/repository

**Files:**
- Create: `src/training/graph.ts`, `src/training/graph.test.ts`
- Create: `src/persistence/db.ts`, `src/persistence/errors.ts`
- Create: `src/persistence/dexieTrainingRepository.ts`
- Create: `src/persistence/dexieTrainingRepository.test.ts`

**Interfaces:**
- Consumes: `positionKeyFromFen`, Phase 2 types/contracts.
- Produces: `deriveTransition(fromFen, move)` and `DexieTrainingRepository`.

- [ ] **Step 1: Write failing graph tests**

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

Catch chess.js move failures and throw `InvalidChessEdgeError` from `src/persistence/errors.ts`.

- [ ] **Step 3: Write failing persistence tests against `fake-indexeddb`**

Each test file begins with:

```ts
import 'fake-indexeddb/auto';
```

Each test database uses `new ChessTrainingDatabase(`test-${crypto.randomUUID()}`)` and calls `await db.delete()` in cleanup.

Required RED cases:
- `ensureLocalLearner()` is idempotent;
- same normalized `positionKey` creates one position row;
- two transposed move orders reuse the same destination position;
- two repertoires reuse the same canonical move edge;
- duplicate `(repertoireId, positionId)` and `(repertoireId, moveEdgeId)` relationships are reused;
- close/reopen the same database name and records persist.

- [ ] **Step 4: Implement centralized Dexie schema**

Use typed `Table<T, string>` properties. Version 1 contains all user/training tables. Version 2 repeats those stores and adds `localBackups`.

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

Internal maintenance record:

```ts
type LocalBackupRecord = {
  id: string;
  createdAt: string;
  reason: 'pre-restore';
  backup: TrainingBackupV1;
};
```

Version 1 uses the same definitions except `localBackups` is absent. Do not clear or recreate user stores during upgrade.

- [ ] **Step 5: Implement graph/repertoire mutation transaction**

`upsertRepertoireTransition` must call `deriveTransition` before writing, then use one Dexie `rw` transaction to get-or-create source/destination positions, move edge, repertoire-position membership, and repertoire-move context. Existing edge `[fromPositionId+moveKey]` must point to the derived destination or the operation throws `InvalidChessEdgeError` and rolls back.

Map IndexedDB/Dexie failures to typed errors: `StorageUnavailableError`, `StorageQuotaError`, `MigrationError`, and `TransactionError`.

- [ ] **Step 6: Add migration-preservation test**

Open a legacy schema-version-1 database, insert learner and repertoire rows, close it, then open through current `ChessTrainingDatabase`. Assert both rows remain and version 2 exposes `localBackups`.

- [ ] **Step 7: Verify graph/persistence**

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
- Produces pure aggregate-stat helpers and transactional `recordAttempt`.

- [ ] **Step 1: Write failing mastery tests**

Use a correct 1200ms outcome and incorrect 2400ms outcome. Assert counts, running average, timestamps, and repertoire streak behavior. `state`, `score`, `nextReviewAt`, and `schedulingData` must remain unchanged because Phase 2 does not implement an adaptive scheduler.

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

Add `nextPositionMastery(current, outcome, timestamp)` and `nextRepertoireMoveMastery(current, outcome, timestamp)`. New records start at `state: 'new'`, `score: 0`, `nextReviewAt: null`, `schedulingData: null`.

- [ ] **Step 3: Write failing atomic repository tests**

Seed learner, repertoire, position, repertoire move, and optional session. After `recordAttempt`, assert one attempt exists, position mastery updates, repertoire-move mastery updates independently, session/context IDs are preserved, and attempt `masteryBefore`/`masteryAfter` match the actual stored state/score values.

Rollback case: call `recordAttempt` with a nonexistent `repertoireMoveId`. Inside the implementation, add the attempt within the transaction before resolving/updating that repertoire mastery record. The missing context must throw; afterward assert attempt count and both mastery tables are unchanged, proving transaction rollback.

- [ ] **Step 4: Implement `recordAttempt`**

Run one Dexie `rw` transaction over `trainingAttempts`, both mastery tables, and `trainingSessions` when a session ID is supplied. Reject negative decision time/hint count, missing repertoire/position/session/context IDs, or a repertoire move belonging to a different repertoire. Capture state/score before updates, compute count/speed/streak updates, capture state/score after updates, store exactly one immutable attempt, and return it.

- [ ] **Step 5: Verify layered mastery and rollback**

```bash
npm test -- src/training/mastery.test.ts src/persistence/dexieTrainingRepository.test.ts
```

Expected: PASS, including assertions that position mastery is not copied into repertoire-move mastery.

- [ ] **Step 6: Commit**

```bash
git add src/training/mastery* src/persistence/dexieTrainingRepository*
git commit -m "feat: record atomic training attempts and mastery"
```

---

### Task 5: Implement versioned backup validation, export, restore, recovery, and reset

**Files:**
- Create: `src/persistence/backupSchema.ts`, `src/persistence/backupSchema.test.ts`
- Create: `src/persistence/backup.ts`, `src/persistence/backup.test.ts`
- Modify: `src/persistence/dexieTrainingRepository.ts`

**Interfaces:**
- Consumes the single `TrainingBackupV1` type from `src/training/types.ts`; do not redefine it.
- Produces `parseAndValidateBackup(input: unknown): TrainingBackupV1` and admin repository behavior.

- [ ] **Step 1: Write failing runtime-validation tests**

Required invalid cases: wrong format; unsupported version; malformed UUID; duplicate UUID; duplicate `positionKey`; broken repertoire/position/move/mastery/attempt reference; illegal move edge; legal move edge whose derived destination differs from the referenced destination. A valid small backup must parse successfully.

- [ ] **Step 2: Implement Zod structural schema typed against `TrainingBackupV1`**

```ts
export const BACKUP_FORMAT = 'chess-decision-trainer' as const;
export const BACKUP_VERSION = 1 as const;

export const trainingBackupV1Schema: z.ZodType<TrainingBackupV1> = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(BACKUP_VERSION),
  exportedAt: z.string(),
  schemaVersion: z.number().int().positive(),
  data: z.object({
    learnerProfiles: z.array(learnerProfileSchema),
    repertoires: z.array(repertoireSchema),
    positions: z.array(positionSchema),
    moveEdges: z.array(moveEdgeSchema),
    repertoirePositions: z.array(repertoirePositionSchema),
    repertoireMoves: z.array(repertoireMoveSchema),
    positionMastery: z.array(positionMasterySchema),
    repertoireMoveMastery: z.array(repertoireMoveMasterySchema),
    trainingSessions: z.array(trainingSessionSchema),
    trainingAttempts: z.array(trainingAttemptSchema),
  }),
});
```

Every ID field uses `z.string().uuid()`; enums mirror the exact unions in `types.ts`.

- [ ] **Step 3: Implement semantic validation after Zod parsing**

Build maps/sets for IDs and position keys. Reject duplicates and broken references. For every move edge, call `deriveTransition(source.fen, stored move)` and require derived source key, `moveKey`, and destination key to match the stored source/destination records. Throw typed `InvalidBackupError`, `UnsupportedBackupVersionError`, `ReferentialIntegrityError`, or `InvalidChessEdgeError`.

- [ ] **Step 4: Write failing export/restore/reset tests**

Test:
1. seed → export → reset/clear → restore → export reproduces the same logical user dataset after ignoring `exportedAt`;
2. structurally invalid, unsupported, referentially invalid, and chess-semantically invalid backups change no user rows;
3. a forced mid-restore failure rolls back both clear and inserts;
4. successful restore leaves a latest pre-restore backup;
5. reset clears user/training data, preserves DB version 2, and recreates one clean local learner.

For exact rollback injection, expose this persistence-only helper:

```ts
export type RestoreHooks = {
  afterClear?: () => void | Promise<void>;
};

export async function restoreBackupData(
  db: ChessTrainingDatabase,
  backup: TrainingBackupV1,
  hooks: RestoreHooks = {},
): Promise<void>;
```

The test passes `afterClear: () => { throw new Error('forced restore failure'); }`; production calls it with no hooks.

- [ ] **Step 5: Implement export and restore sequence**

`exportBackup` reads all user/training tables in one read transaction and emits the type from Task 2. `restoreBackupData` must validate before mutation, store a pre-restore snapshot in `localBackups`, start one `rw` transaction across replaceable user tables, clear them, call `await hooks.afterClear?.()`, bulk-add imported rows preserving IDs, run final count/reference checks, then commit. `localBackups` is maintenance data and is not part of the replaceable dataset.

`resetTrainingData` clears all replaceable user/training tables transactionally, keeps `localBackups` and schema intact, then creates one new `Local learner` profile.

- [ ] **Step 6: Verify backup behavior**

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

### Task 6: Add UI-facing training-data service and browser composition

**Files:**
- Create: `src/services/trainingDataService.ts`, `src/services/trainingDataService.test.ts`
- Create: `src/persistence/browserRepository.ts`

**Interfaces:**
- Produces `TrainingDataService`; React never receives a Dexie table/database object.

- [ ] **Step 1: Write failing service summary tests**

Seed one learner, two repertoires, shared graph records, one attempt, and mastery. Assert `getSummary()` returns the exact `TrainingDataSummary` shape from Task 2, including two repertoire summaries, global counts, last activity, and schema version 2. On a fresh DB, `initialize()` must create exactly one learner and report zero repertoires/attempts.

- [ ] **Step 2: Implement service**

```ts
export class TrainingDataService {
  constructor(
    private readonly training: TrainingRepository,
    private readonly admin: TrainingAdminRepository,
  ) {}

  async initialize(): Promise<TrainingDataSummary> {
    await this.training.ensureLocalLearner('Local learner');
    return this.admin.getSummary();
  }

  refreshSummary(): Promise<TrainingDataSummary> {
    return this.admin.getSummary();
  }

  exportBackup(): Promise<TrainingBackupV1> {
    return this.admin.exportBackup();
  }

  validateBackup(input: unknown): TrainingBackupV1 {
    return parseAndValidateBackup(input);
  }

  async restoreBackup(backup: TrainingBackupV1): Promise<TrainingDataSummary> {
    await this.admin.restoreBackup(backup);
    return this.admin.getSummary();
  }

  getPreRestoreBackup(): Promise<TrainingBackupV1 | null> {
    return this.admin.getLatestPreRestoreBackup();
  }

  async reset(): Promise<TrainingDataSummary> {
    await this.admin.resetTrainingData();
    return this.admin.getSummary();
  }
}
```

- [ ] **Step 3: Add browser composition factory**

`browserRepository.ts` constructs one `ChessTrainingDatabase('chess-decision-trainer')`, one `DexieTrainingRepository`, and one `TrainingDataService`. Export `getBrowserTrainingDataService()` only; do not export the raw database.

- [ ] **Step 4: Verify service**

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
- Create: `src/components/TrainingDataPanel.tsx`, `src/components/TrainingDataPanel.test.tsx`
- Modify: `src/App.tsx`, `src/App.test.tsx`, `src/styles.css`

**Interfaces:**
- `TrainingDataPanel` accepts `service?: TrainingDataService`; production defaults to `getBrowserTrainingDataService()`.

- [ ] **Step 1: Write failing component tests with a fake service**

Required cases:
- initialization renders learner, repertoire names/counts, global counts, schema version, and last activity;
- Export creates JSON `Blob` and a filename beginning `chess-decision-trainer-backup-`;
- invalid selected JSON shows validation failure and no replace action;
- valid selected backup shows repertoire/position/attempt counts before replacement;
- restore requires explicit `Replace local data` confirmation;
- reset requires explicit confirmation;
- successful restore refreshes counts;
- existing pre-restore backup exposes `Download pre-restore backup`;
- service failure renders `role="alert"` and does not remove the chess board.

Do not mock Dexie in component tests; use a fake `TrainingDataService` object.

- [ ] **Step 2: Implement JSON file/download helpers**

Read selected files with `await file.text()` and `JSON.parse`. Downloads use:

```ts
const blob = new Blob([JSON.stringify(backup, null, 2)], {
  type: 'application/json',
});
const url = URL.createObjectURL(blob);
const link = document.createElement('a');
link.href = url;
link.download = filename;
link.click();
URL.revokeObjectURL(url);
```

- [ ] **Step 3: Implement intentionally narrow utility panel**

Render: `Training data` heading; active learner; repertoire list with position/move/attempt counts; global counts; last activity; schema version; Export backup; labeled restore file input; parsed backup summary; explicit replace confirmation; pre-restore backup download when available; explicit reset confirmation. Do not add repertoire authoring, opening drills, graph visualization, or mastery dashboard.

- [ ] **Step 4: Integrate with `App` without touching chess truth**

Render `<TrainingDataPanel />` beneath the existing game layout. Leave `ChessGame`, clock, move legality, and Phase 1 telemetry state unchanged. Update the eyebrow to `Phase 2 · Local training data`.

- [ ] **Step 5: Add responsive styles**

Reuse existing panel styling. Ensure file inputs/buttons wrap at ~320px, long names/status text wrap, and no utility content causes page-level horizontal scrolling.

- [ ] **Step 6: Verify UI plus Phase 1 regressions**

```bash
npm test -- src/components/TrainingDataPanel.test.tsx src/App.test.tsx
npm test
npm run typecheck
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/TrainingDataPanel* src/App.tsx src/App.test.tsx src/styles.css
git commit -m "feat: add local training data management ui"
```

---

### Task 8: Add real-browser persistence smoke, CI coverage, docs, and final verification

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `playwright.config.ts`, `src/e2e/persistence.spec.ts`
- Modify: `.github/workflows/ci.yml`, `README.md`

**Interfaces:**
- Produces `npm run test:e2e` against Vite preview using system Chrome.

- [ ] **Step 1: Add Playwright script/config**

Add `"test:e2e": "playwright test"` to scripts.

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

- [ ] **Step 2: Write the real-browser persistence smoke through public UI**

Construct a valid backup containing one learner, one repertoire named `Persistence Smoke Repertoire`, one starting `Position`, and one `RepertoirePosition`. Upload through the visible restore input, confirm replacement, assert the repertoire and position count appear, reload the page, and assert they remain.

```ts
await expect(page.getByText('Persistence Smoke Repertoire')).toBeVisible();
await page.reload();
await expect(page.getByText('Persistence Smoke Repertoire')).toBeVisible();
```

Then trigger Export backup, read the downloaded JSON, and assert `format === 'chess-decision-trainer'`, `version === 1`, and the repertoire is present.

- [ ] **Step 3: Fix CI trigger and add persistence smoke**

Replace the stale Phase-1-only push branch filter with:

```yaml
on:
  push:
    branches:
      - main
      - 'feature/**'
  pull_request:
```

Keep `npm ci`, unit tests, typecheck, build, and existing desktop/mobile screenshot smoke. Add after build:

```yaml
- name: Browser persistence smoke
  run: npm run test:e2e
```

Do not run `playwright install`; the config uses the system `google-chrome` already used by the workflow.

- [ ] **Step 4: Update README**

Document Phase 2 local persistence, shared transposition graph, multiple repertoires, layered mastery, attempt history, versioned backup/replace restore, browser-local/no-cloud limitation, and `npm run test:e2e`. Keep opening trainer, FSRS, Stockfish, accounts, sync, and merge conflict handling explicitly deferred.

- [ ] **Step 5: Run clean-install verification**

```bash
rm -rf node_modules dist
npm ci
npm test
npm run typecheck
npm run build
npm run test:e2e
```

Expected: every command exits successfully with zero failed tests.

- [ ] **Step 6: Run final spec acceptance audit**

Confirm with evidence: ineffective en-passant key fixed; transpositions deduplicate; move edges are legal/destination-consistent; multiple repertoires share graph records; mastery layers remain distinct; attempt/mastery and graph writes are atomic; schema migration preserves records; real browser reload preserves data; backup export/restore round-trip works; invalid restore leaves data unchanged; pre-restore backup exists; reset preserves schema/recreates learner; no Phase 3 trainer/editor features were introduced.

- [ ] **Step 7: Commit final CI/docs work only after green evidence**

```bash
git add package.json package-lock.json playwright.config.ts src/e2e/ .github/workflows/ci.yml README.md
git commit -m "test: verify phase 2 local persistence"
```

If verification exposes a defect, fix it under the same red/green discipline before committing. Do not mark Phase 2 complete from code inspection alone.
