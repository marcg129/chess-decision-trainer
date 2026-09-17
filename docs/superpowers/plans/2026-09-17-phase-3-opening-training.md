# Phase 3 Opening Training MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first usable opening-training workflow: import a validated PGN repertoire, practice full lines, drill weak positions, receive guided correction and speed feedback, and persist attempts/mastery through the existing Phase 2 data model.

**Architecture:** Add a plain-TypeScript `src/openings` subsystem for PGN normalization, import planning, selection policies, and the runtime training engine. Keep chess legality in `ChessGame`, durable data behind the existing `TrainingRepository`, Dexie isolated in `src/persistence`, and React as a thin presentation layer. The existing Phase 2 canonical graph remains the only durable repertoire graph.

**Tech Stack:** React 19.3.0, TypeScript 7.0.2, Vite 8.3.0, Vitest 5.0.1, Playwright 1.63.0, chess.js 1.4.0, Dexie 4.4.6, Zod 4.6.5, `@echecs/pgn` 5.0.0.

**Spec:** `docs/superpowers/specs/2026-09-17-phase-3-opening-training-design.md`

## Global Constraints

- Do not add Stockfish, FSRS, cloud sync, accounts, a visual repertoire editor, or import-merging into an existing repertoire.
- PGN import always creates one new repertoire from the selected games; the built-in demo is the only idempotent fixed-ID repertoire.
- Selected games in one import must resolve to the same root position. Reject a selection containing different root position keys rather than creating a disconnected Practice Line graph.
- `chess.js`/`ChessGame` is authoritative for move legality and resulting FEN; the PGN parser only supplies syntax/annotation structure.
- React must not own grading, weighted selection, persistence rules, or PGN graph semantics.
- Dexie must not leak into `src/openings`, React components, or service consumers.
- No IndexedDB schema/store/index change is needed for Phase 3. Keep DB schema version 2 and backup format version 1 unless implementation discovers an unavoidable indexed-field change.
- Preserve attempt quality without extending the backup schema: `TrainingAttempt.actualMove` stores the first submitted legal move, `correct` means the first submitted legal move was accepted, `hintCount`/`hintUsed` record assistance, and `repertoireMoveId` identifies the accepted move eventually played. A corrected miss must therefore persist as `correct: false` even though the learner later enters the right move.
- Use a stable attempt idempotency key on persistence retry so one resolved prompt cannot increment mastery twice.
- Default soft speed target: `5_000` ms. Slower correct moves remain correct.
- Quick Recall target size: `10` prompts. If fewer than ten trainable positions exist, finish after every eligible position has appeared once; do not manufacture duplicate prompts merely to reach ten.
- Top-level navigation is `Train | Play | Data`, with `Train` the default Phase 3 surface.
- Keep mobile usability at approximately 320px with no horizontal overflow.
- Run TDD RED → GREEN for each behavior and commit each task independently.

---

## File Structure

### New opening-domain files

- `src/openings/pgn/types.ts` — parser-neutral PGN game/move/variation types.
- `src/openings/pgn/parsePgn.ts` — adapter around `@echecs/pgn`.
- `src/openings/pgn/parsePgn.test.ts` — multi-game/RAV/comment/parser-error coverage.
- `src/openings/import/types.ts` — import preview/plan/warning contracts.
- `src/openings/import/resolveNotation.ts` — resolve parsed notation against legal `ChessGame` moves.
- `src/openings/import/resolveNotation.test.ts` — castling, promotion, disambiguation, illegal/ambiguous move coverage.
- `src/openings/import/buildImportPlan.ts` — walk selected games/variations, validate roots, dedupe transitions, assign roles/preferred moves/comments.
- `src/openings/import/buildImportPlan.test.ts` — multi-game merge, variation, comment, conflict-warning, transposition, bad-root coverage.
- `src/openings/demoPgn.ts` — built-in demo PGN and stable demo repertoire id.
- `src/openings/training/types.ts` — runtime prompt/session/feedback contracts.
- `src/openings/training/selectors.ts` — weighted opponent and Quick Recall selection.
- `src/openings/training/selectors.test.ts` — deterministic weighting tests.
- `src/openings/training/speed.ts` — soft target feedback.
- `src/openings/training/speed.test.ts` — target/slow feedback tests.
- `src/openings/training/engine.ts` — stateful plain-TypeScript Practice Line / Quick Recall engine.
- `src/openings/training/engine.test.ts` — grading, correction, hints, persistence retry, completion coverage.
- `src/services/openingTrainingService.ts` — browser/UI-facing façade for import, demo, repertoire listing, and session creation.
- `src/services/openingTrainingService.test.ts` — façade and idempotent demo tests.

### New UI files

- `src/components/OpeningTrainingHome.tsx` — repertoire chooser and Practice Line / Quick Recall launch surface.
- `src/components/OpeningTrainingHome.test.tsx` — repertoire and launch behavior.
- `src/components/PgnImportPanel.tsx` — file parse, game selection, side/name, preview, confirmation.
- `src/components/PgnImportPanel.test.tsx` — import wizard behavior and errors.
- `src/components/OpeningTrainer.tsx` — board, hints, feedback, retry, progress.
- `src/components/OpeningTrainer.test.tsx` — UI bridge to training engine.
- `src/components/OpeningTrainingPage.tsx` — Train sub-navigation between home/import/active session.
- `src/components/PlaySurface.tsx` — extracted existing Phase 1 free-play experience.
- `src/components/AppNav.tsx` — Train / Play / Data tabs.
- `src/utils/readFileText.ts` — shared browser/test-compatible file reader.
- `src/openingTraining.css` — training/import/navigation responsive styles.
- `src/e2e/openingTraining.spec.ts` — real-browser import/reload/train/mobile flow.

### Existing files to modify

- `package.json`, `package-lock.json` — pin `@echecs/pgn` 5.0.0.
- `src/core/game.ts`, `src/core/game.test.ts` — expose all legal moves without leaking raw chess.js.
- `src/training/repositories.ts` — bulk import/read snapshot/session completion/idempotent attempt contracts.
- `src/persistence/dexieTrainingRepository.ts`, `src/persistence/dexieTrainingRepository.test.ts`, `src/persistence/attemptRecording.test.ts` — implement repository additions transactionally.
- `src/persistence/browserRepository.ts` — compose the data and opening-training services over one DB/repository singleton.
- `src/components/TrainingDataPanel.tsx` — use shared `readFileText` helper only; no behavior change.
- `src/App.tsx`, `src/App.test.tsx`, `src/App.smoke.test.tsx` — top-level navigation and Play extraction.
- `src/main.tsx` — import `openingTraining.css`.
- `README.md` — document Phase 3 workflows and scope.

---

### Task 1: Add a Parser-Neutral PGN Adapter

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/openings/pgn/types.ts`
- Create: `src/openings/pgn/parsePgn.ts`
- Create: `src/openings/pgn/parsePgn.test.ts`

**Interfaces:**
- Consumes: `@echecs/pgn` 5.0.0 `parse()` and its `PGN`, `Notation`, `NotationList`, `ParseError`, `ParseWarning` types.
- Produces:

```ts
export type ParsedPgnMove = {
  turn: 'w' | 'b';
  moveNumber: number;
  piece: 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
  to?: string;
  fromHint?: string;
  capture: boolean;
  castle: 'kingside' | 'queenside' | null;
  promotion?: 'q' | 'r' | 'b' | 'n';
  comment?: string;
  annotations: string[];
  variations: ParsedPgnLine[];
};

export type ParsedPgnLine = ParsedPgnMove[];

export type ParsedPgnGame = {
  index: number;
  tags: Record<string, string>;
  moves: ParsedPgnLine;
};

export type PgnIssue = {
  severity: 'warning' | 'error';
  message: string;
  line: number;
  column: number;
};

export type ParsedPgnDocument = {
  games: ParsedPgnGame[];
  warnings: PgnIssue[];
};

export function parsePgnSource(input: string): ParsedPgnDocument;
```

- [ ] **Step 1: Add the exact PGN dependency**

Run:

```bash
npm install --save-exact @echecs/pgn@5.0.0
```

Expected: `package.json` contains `"@echecs/pgn": "5.0.0"` and the lockfile updates.

- [ ] **Step 2: Write failing parser tests for multi-game input, nested RAVs, comments, and parse errors**

Create `src/openings/pgn/parsePgn.test.ts` with focused assertions like:

```ts
import { describe, expect, it } from 'vitest';
import { parsePgnSource } from './parsePgn';

describe('parsePgnSource', () => {
  it('normalizes multiple games, nested variations, and comments', () => {
    const parsed = parsePgnSource(`
[Event "One"]
[Result "*"]
1. e4 {King pawn} e5 (1... c5 (1... e6)) 2. Nf3 *

[Event "Two"]
[Result "*"]
1. d4 d5 2. c4 *
`);

    expect(parsed.games).toHaveLength(2);
    expect(parsed.games[0].moves[0]).toMatchObject({
      turn: 'w',
      moveNumber: 1,
      piece: 'p',
      to: 'e4',
      comment: 'King pawn',
    });
    expect(parsed.games[0].moves[1].variations).toHaveLength(1);
    expect(parsed.games[0].moves[1].variations[0][0].to).toBe('c5');
    expect(parsed.games[0].moves[1].variations[0][0].variations[0][0].to).toBe('e6');
  });

  it('throws a useful error when the parser reports invalid PGN', () => {
    expect(() => parsePgnSource('1. e4 e5 2. ???')).toThrow(/PGN/i);
  });
});
```

- [ ] **Step 3: Run the new test and confirm RED**

Run:

```bash
npm test -- src/openings/pgn/parsePgn.test.ts
```

Expected: FAIL because `parsePgnSource` and parser-neutral types do not exist.

- [ ] **Step 4: Implement the parser-neutral adapter**

In `parsePgn.ts`, call `parse(input, { onError, onWarning })`, convert paired `NotationList` entries into sequential white/black moves, map parser piece names to chess.js piece letters, and recursively normalize `notation.variants`.

Core conversion shape:

```ts
function normalizeLine(list: NotationList): ParsedPgnLine {
  const moves: ParsedPgnMove[] = [];
  for (const [moveNumber, white, black] of list) {
    if (white) moves.push(normalizeMove(white, 'w', moveNumber));
    if (black) moves.push(normalizeMove(black, 'b', moveNumber));
  }
  return moves;
}

function normalizeMove(notation: Notation, turn: 'w' | 'b', moveNumber: number): ParsedPgnMove {
  return {
    turn,
    moveNumber,
    piece: pieceCode(notation.piece),
    to: notation.to,
    fromHint: notation.from,
    capture: notation.capture,
    castle: notation.castling ? (notation.long ? 'queenside' : 'kingside') : null,
    promotion: notation.promotion ? promotionCode(notation.promotion) : undefined,
    comment: notation.comment?.trim() || undefined,
    annotations: notation.annotations ?? [],
    variations: (notation.variants ?? []).map(normalizeLine),
  };
}
```

If `onError` fires or `parse()` returns no games for non-empty text, throw an `Error` that includes line/column when available. Preserve parser warnings in `ParsedPgnDocument.warnings`; do not reject missing seven-tag-roster metadata.

- [ ] **Step 5: Run parser tests and the full unit suite**

Run:

```bash
npm test -- src/openings/pgn/parsePgn.test.ts
npm test
```

Expected: parser tests PASS; existing tests remain green.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/openings/pgn
git commit -m "feat: parse multi-game opening pgn"
```

---

### Task 2: Build a Fully Validated Import Plan

**Files:**
- Modify: `src/core/game.ts`
- Modify: `src/core/game.test.ts`
- Create: `src/openings/import/types.ts`
- Create: `src/openings/import/resolveNotation.ts`
- Create: `src/openings/import/resolveNotation.test.ts`
- Create: `src/openings/import/buildImportPlan.ts`
- Create: `src/openings/import/buildImportPlan.test.ts`

**Interfaces:**
- Consumes: `ParsedPgnDocument`, `ParsedPgnMove`, `ChessGame`, `deriveTransition()`, `positionKeyFromFen()`.
- Produces:

```ts
export type ImportSide = 'white' | 'black';

export type PlannedRepertoireTransition = {
  fromFen: string;
  move: TrainingMoveInput;
  role: RepertoireMoveRole;
  preferred: boolean;
  trainable: boolean;
  order: number;
  explanation?: string;
};

export type ImportWarning = {
  code: 'parser-warning' | 'preferred-move-conflict';
  message: string;
  gameIndexes: number[];
};

export type RepertoireImportPlan = {
  name: string;
  side: ImportSide;
  rootFen: string;
  rootPositionKey: string;
  selectedGameIndexes: number[];
  transitions: PlannedRepertoireTransition[];
  warnings: ImportWarning[];
  counts: {
    games: number;
    positions: number;
    moves: number;
    learnerMoves: number;
    opponentMoves: number;
  };
};

export function resolveParsedMove(game: ChessGame, move: ParsedPgnMove): TrainingMoveInput;

export function buildRepertoireImportPlan(
  document: ParsedPgnDocument,
  input: { name: string; side: ImportSide; selectedGameIndexes: number[] },
): RepertoireImportPlan;
```

- [ ] **Step 1: Expose all legal moves through the existing chess domain**

Add a failing test to `src/core/game.test.ts`:

```ts
it('exposes all legal moves without leaking the chess.js instance', () => {
  const game = new ChessGame();
  expect(game.allLegalMoves()).toHaveLength(20);
  expect(game.allLegalMoves().some((move) => move.from === 'e2' && move.to === 'e4')).toBe(true);
});
```

Run:

```bash
npm test -- src/core/game.test.ts
```

Expected: FAIL because `allLegalMoves()` does not exist.

Implement in `src/core/game.ts`:

```ts
allLegalMoves(): Move[] {
  return this.chess.moves({ verbose: true });
}
```

Run the same test again; expected PASS.

- [ ] **Step 2: Write failing notation-resolution tests**

Cover ordinary SAN disambiguation, castling, and promotion using parser-neutral moves. Example:

```ts
it('resolves a parser move against legal chess moves', () => {
  const game = new ChessGame();
  expect(resolveParsedMove(game, {
    turn: 'w', moveNumber: 1, piece: 'p', to: 'e4', capture: false,
    castle: null, annotations: [], variations: [],
  })).toEqual({ from: 'e2', to: 'e4' });
});
```

Also assert that a descriptor matching zero legal moves throws `PGN game 1`-friendly validation text at the caller, and a descriptor matching more than one legal move throws an ambiguity error rather than guessing.

- [ ] **Step 3: Implement legal-move resolution**

Match only against `game.allLegalMoves()`:

```ts
const candidates = game.allLegalMoves().filter((legal) => {
  if (move.castle === 'kingside') return legal.san === 'O-O';
  if (move.castle === 'queenside') return legal.san === 'O-O-O';
  if (legal.piece !== move.piece || legal.to !== move.to) return false;
  if (move.promotion && legal.promotion !== move.promotion) return false;
  if (!move.fromHint) return true;
  if (move.fromHint.length === 2) return legal.from === move.fromHint;
  return legal.from.startsWith(move.fromHint) || legal.from.endsWith(move.fromHint);
});
```

Require exactly one candidate, then return `{ from, to, promotion }`. The app never trusts the parser to supply a legal origin square.

- [ ] **Step 4: Write failing import-plan tests**

Cover all approved semantics in `buildImportPlan.test.ts`:

```ts
it('merges selected games, preserves variations/comments, and assigns learner/opponent roles', () => {
  const doc = parsePgnSource(`
[Event "A"]
[Result "*"]
1. e4 {Claim the center} e5 2. Nf3 Nc6 *

[Event "B"]
[Result "*"]
1. e4 c5 2. Nf3 d6 *
`);
  const plan = buildRepertoireImportPlan(doc, {
    name: 'White starter', side: 'white', selectedGameIndexes: [0, 1],
  });

  expect(plan.counts.games).toBe(2);
  expect(plan.transitions.some((move) => move.role === 'learner' && move.explanation === 'Claim the center')).toBe(true);
  expect(plan.transitions.some((move) => move.role === 'opponent')).toBe(true);
});
```

Add explicit tests for:

```ts
// exactly one preferred learner move per source position
expect(preferredAtPosition).toHaveLength(1);

// later game conflicting main-line move becomes accepted alternative + warning
expect(plan.warnings.some((warning) => warning.code === 'preferred-move-conflict')).toBe(true);

// nested RAV starts from the position before the move it replaces
expect(variationTransition.fromFen).toBe(expectedBranchFen);

// selected games with different root FENs are rejected
expect(() => buildRepertoireImportPlan(mixedRoots, input)).toThrow(/same root/i);
```

- [ ] **Step 5: Implement root handling and main-line-first traversal**

For each selected game, derive initial FEN as:

```ts
const rootFen = game.tags.SetUp === '1' && game.tags.FEN
  ? game.tags.FEN
  : new ChessGame().snapshot().fen;
```

Validate each root by constructing `ChessGame(rootFen)`. Require all selected roots to share `positionKeyFromFen(rootFen)`.

Walk each line with a separate `ChessGame` instance. A variation attached to a move starts from that move's `beforeFen`, because it replaces the owning move. Process the owning main move before sibling variations so preference discovery is main-line-first.

- [ ] **Step 6: Implement deterministic role/preference/deduplication rules**

For every occurrence:

```ts
const role: RepertoireMoveRole =
  game.snapshot().turn === (input.side === 'white' ? 'w' : 'b')
    ? 'learner'
    : 'opponent';
```

Use `deriveTransition(fromFen, resolvedMove)` to get the normalized source key and canonical `moveKey`. Deduplicate by `${fromPositionKey}|${moveKey}`.

For learner positions:

1. For each selected game, the first move encountered at that position by main-line-first traversal is that game's preferred candidate.
2. The earliest selected game in source-PGN order wins globally.
3. Every other imported learner move is accepted with `preferred: false`.
4. If a later selected game's preferred candidate differs, add one `preferred-move-conflict` warning naming both game indexes.

Set `trainable: role === 'learner'`. Keep the first non-empty comment for a duplicated transition as `explanation`. Assign stable numeric `order` from traversal order.

- [ ] **Step 7: Run focused and full tests**

```bash
npm test -- src/core/game.test.ts src/openings/import/resolveNotation.test.ts src/openings/import/buildImportPlan.test.ts
npm test
npm run typecheck
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add src/core src/openings/import
git commit -m "feat: build validated repertoire import plans"
```

---

### Task 3: Add Atomic Bulk Import and Training Read Queries

**Files:**
- Modify: `src/training/repositories.ts`
- Modify: `src/persistence/dexieTrainingRepository.ts`
- Modify: `src/persistence/dexieTrainingRepository.test.ts`
- Modify: `src/persistence/attemptRecording.test.ts`

**Interfaces:**
- Consumes: current Phase 2 tables/types and `PlannedRepertoireTransition`-compatible fields.
- Produces these repository contracts:

```ts
export type RepertoireTransitionInput = {
  repertoireId: EntityId;
  fromFen: string;
  move: TrainingMoveInput;
  role: RepertoireMoveRole;
  preferred: boolean;
  trainable: boolean;
  order?: number;
  explanation?: string;
};

export type CreateRepertoireImportInput = {
  repertoire: Repertoire;
  transitions: RepertoireTransitionInput[];
};

export type RepertoireTrainingSnapshot = {
  repertoire: Repertoire;
  positions: Position[];
  moveEdges: MoveEdge[];
  repertoirePositions: RepertoirePosition[];
  repertoireMoves: RepertoireMove[];
  positionMastery: PositionMastery[];
  repertoireMoveMastery: RepertoireMoveMastery[];
  attempts: TrainingAttempt[];
};

export type RecordAttemptInput = Omit<
  TrainingAttempt,
  'id' | 'masteryBefore' | 'masteryAfter'
> & { attemptId?: EntityId };

export interface TrainingRepository {
  // existing methods remain
  getRepertoire(repertoireId: EntityId): Promise<Repertoire | undefined>;
  createRepertoireFromTransitions(input: CreateRepertoireImportInput): Promise<void>;
  loadRepertoireTrainingSnapshot(repertoireId: EntityId): Promise<RepertoireTrainingSnapshot>;
  completeSession(sessionId: EntityId, completedAt: string): Promise<void>;
}
```

- [ ] **Step 1: Write failing repository tests for atomic import and canonical reuse**

In `dexieTrainingRepository.test.ts`, add:

```ts
it('creates a repertoire and all transitions atomically', async () => {
  await repo.createRepertoireFromTransitions({ repertoire, transitions });
  expect(await db.repertoires.get(repertoire.id)).toEqual(repertoire);
  expect(await db.repertoireMoves.count()).toBeGreaterThan(0);
});

it('does not leave a partial repertoire when one transition is invalid', async () => {
  await expect(repo.createRepertoireFromTransitions({
    repertoire,
    transitions: [validTransition, invalidTransition],
  })).rejects.toThrow();
  expect(await db.repertoires.get(repertoire.id)).toBeUndefined();
  expect(await db.repertoireMoves.count()).toBe(0);
});

it('reuses canonical positions and move edges across separate repertoires', async () => {
  await repo.createRepertoireFromTransitions(firstImport);
  const positionsAfterFirst = await db.positions.count();
  const edgesAfterFirst = await db.moveEdges.count();
  await repo.createRepertoireFromTransitions(secondImportWithSameOpening);
  expect(await db.positions.count()).toBe(positionsAfterFirst);
  expect(await db.moveEdges.count()).toBe(edgesAfterFirst);
  expect(await db.repertoires.count()).toBe(2);
});
```

- [ ] **Step 2: Write failing snapshot/session tests**

Assert that `loadRepertoireTrainingSnapshot(id)` returns only that repertoire's memberships/moves/attempts plus referenced canonical positions/edges/mastery, and that `completeSession()` writes `completedAt` without replacing other session fields.

- [ ] **Step 3: Write a failing idempotent-attempt retry test**

In `attemptRecording.test.ts`:

```ts
it('returns the existing attempt without updating mastery twice when attemptId is retried', async () => {
  const input = { ...validAttemptInput, attemptId: '11111111-1111-4111-8111-111111111111' };
  const first = await repo.recordAttempt(input);
  const second = await repo.recordAttempt(input);
  expect(second.id).toBe(first.id);
  expect(await db.trainingAttempts.count()).toBe(1);
  expect((await db.positionMastery.toArray())[0].attempts).toBe(1);
});
```

- [ ] **Step 4: Update the repository contracts**

Add the exact types/signatures above to `src/training/repositories.ts`. Keep all pre-existing methods unchanged.

- [ ] **Step 5: Refactor transition persistence into one transaction-safe helper**

Before mutating IndexedDB, validate every bulk transition with `deriveTransition()`:

```ts
const derived = input.transitions.map((transition) => ({
  input: transition,
  transition: deriveTransition(transition.fromFen, transition.move),
}));
```

Then open one Dexie `rw` transaction over `repertoires`, `positions`, `moveEdges`, `repertoirePositions`, and `repertoireMoves`. Add the repertoire first and upsert all prevalidated transitions inside that same transaction. Do not call a method that opens an unrelated transaction for each edge.

When creating/updating a `RepertoireMove`, persist:

```ts
{
  role: input.role,
  preferred: input.preferred,
  order: input.order,
  explanation: existing?.explanation ?? input.explanation,
}
```

When repeated selected games reference the same source membership, `RepertoirePosition.trainable` becomes `existing.trainable || input.trainable`.

- [ ] **Step 6: Implement snapshot loading and session completion**

Load repertoire memberships first, then resolve only referenced positions/edges/mastery rows. Fetch attempts with `trainingAttempts.where('repertoireId').equals(repertoireId)`.

`completeSession` must reject a missing session and otherwise `update(sessionId, { completedAt })`.

- [ ] **Step 7: Implement attempt idempotency**

At the beginning of the existing `recordAttempt` transaction:

```ts
if (input.attemptId) {
  const existing = await this.db.trainingAttempts.get(input.attemptId);
  if (existing) return existing;
}
```

When creating the attempt:

```ts
const attempt: TrainingAttempt = {
  ...restOfInput,
  id: input.attemptId ?? createId(),
  masteryBefore,
  masteryAfter,
};
```

Do not add any new object store, index, or backup field.

- [ ] **Step 8: Run focused persistence tests and full verification**

```bash
npm test -- src/persistence/dexieTrainingRepository.test.ts src/persistence/attemptRecording.test.ts
npm test
npm run typecheck
```

Expected: PASS; DB schema remains version 2.

- [ ] **Step 9: Commit**

```bash
git add src/training/repositories.ts src/persistence/dexieTrainingRepository.ts src/persistence/dexieTrainingRepository.test.ts src/persistence/attemptRecording.test.ts
git commit -m "feat: add atomic opening repertoire persistence"
```

---

### Task 4: Add the Opening Training Service and Built-In Demo

**Files:**
- Create: `src/openings/demoPgn.ts`
- Create: `src/services/openingTrainingService.ts`
- Create: `src/services/openingTrainingService.test.ts`
- Modify: `src/persistence/browserRepository.ts`

**Interfaces:**
- Consumes: `TrainingRepository`, `parsePgnSource()`, `buildRepertoireImportPlan()`.
- Produces:

```ts
export const DEMO_REPERTOIRE_ID = '00000000-0000-4000-8000-000000000003';

export class OpeningTrainingService {
  constructor(private readonly training: TrainingRepository) {}

  parsePgn(input: string): ParsedPgnDocument;
  previewImport(input: {
    document: ParsedPgnDocument;
    name: string;
    side: ImportSide;
    selectedGameIndexes: number[];
  }): RepertoireImportPlan;
  commitImport(plan: RepertoireImportPlan): Promise<Repertoire>;
  ensureDemoRepertoire(): Promise<Repertoire>;
  listRepertoires(): Promise<Repertoire[]>;
  loadRepertoire(repertoireId: EntityId): Promise<RepertoireTrainingSnapshot>;
}
```

Later Task 6 adds session-engine creation methods to this same class.

- [ ] **Step 1: Write failing service tests**

Cover user import and demo idempotency:

```ts
it('commits a preview as one new repertoire', async () => {
  const doc = service.parsePgn(USER_PGN);
  const plan = service.previewImport({
    document: doc, name: 'My White Repertoire', side: 'white', selectedGameIndexes: [0],
  });
  const repertoire = await service.commitImport(plan);
  expect(repertoire.name).toBe('My White Repertoire');
  expect(repertoire.side).toBe('white');
});

it('installs the built-in demo idempotently', async () => {
  const first = await service.ensureDemoRepertoire();
  const second = await service.ensureDemoRepertoire();
  expect(first.id).toBe(DEMO_REPERTOIRE_ID);
  expect(second.id).toBe(DEMO_REPERTOIRE_ID);
  expect(await db.repertoires.count()).toBe(1);
});
```

- [ ] **Step 2: Add a small demo PGN with comments and opponent variations**

Use one known-good standard-start fixture, for example:

```ts
export const DEMO_PGN = `[Event "Italian Game Demo"]
[White "Learner"]
[Black "Trainer"]
[Result "*"]

1. e4 {Claim central space.} e5 (1... c5 2. Nf3 d6)
2. Nf3 Nc6 3. Bc4 {Develop toward f7.} Nf6 (3... Bc5 4. c3)
4. d3 Bc5 5. O-O d6 *`;
```

The demo is White-side and uses the exact same parse → preview → repository bulk-import path as user PGNs.

- [ ] **Step 3: Implement user import commit**

`commitImport` must call `ensureLocalLearner()`, create one `Repertoire` with `createId()`, map plan transitions to `RepertoireTransitionInput` using that id, then call `createRepertoireFromTransitions()` once.

- [ ] **Step 4: Implement idempotent demo installation**

First call `getRepertoire(DEMO_REPERTOIRE_ID)`. Return it if present. Otherwise parse/preview `DEMO_PGN`, create a `Repertoire` using the fixed ID, and bulk import it. Do not special-case any later training behavior based on this ID.

- [ ] **Step 5: Share one browser repository instance between Phase 2 and Phase 3 services**

Refactor `browserRepository.ts` from a single service cache to one runtime cache:

```ts
type BrowserTrainingRuntime = {
  data: TrainingDataService;
  openings: OpeningTrainingService;
};

let runtime: BrowserTrainingRuntime | null = null;

function getRuntime(): BrowserTrainingRuntime {
  if (runtime) return runtime;
  const db = new ChessTrainingDatabase('chess-decision-trainer');
  const training = new DexieTrainingRepository(db);
  const admin = new DexieTrainingAdminRepository(db);
  runtime = {
    data: new TrainingDataService(training, admin),
    openings: new OpeningTrainingService(training),
  };
  return runtime;
}

export const getBrowserTrainingDataService = () => getRuntime().data;
export const getBrowserOpeningTrainingService = () => getRuntime().openings;
```

- [ ] **Step 6: Run tests**

```bash
npm test -- src/services/openingTrainingService.test.ts
npm test
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/openings/demoPgn.ts src/services/openingTrainingService.ts src/services/openingTrainingService.test.ts src/persistence/browserRepository.ts
git commit -m "feat: add opening training import service"
```

---

### Task 5: Implement Deterministic Selection and Speed Policies

**Files:**
- Create: `src/openings/training/types.ts`
- Create: `src/openings/training/selectors.ts`
- Create: `src/openings/training/selectors.test.ts`
- Create: `src/openings/training/speed.ts`
- Create: `src/openings/training/speed.test.ts`

**Interfaces:**
- Consumes: `RepertoireTrainingSnapshot`, Phase 2 mastery and attempt records.
- Produces:

```ts
export type OpeningMoveChoice = {
  repertoireMove: RepertoireMove;
  moveEdge: MoveEdge;
  toPosition: Position;
};

export type WeightedCandidate<T> = { value: T; weight: number };

export function chooseWeighted<T>(
  candidates: WeightedCandidate<T>[],
  random: () => number,
): T;

export function opponentResponseWeight(input: {
  destinationAttempts: number;
  sessionExposure: number;
}): number;

export function quickRecallWeight(input: {
  attempts: number;
  incorrect: number;
  hintedAttempts: number;
  slowAttempts: number;
}): number;

export type SpeedFeedback = {
  targetMs: number;
  status: 'good' | 'slow';
  label: string;
};

export function getSpeedFeedback(decisionTimeMs: number, targetMs?: number): SpeedFeedback;
```

- [ ] **Step 1: Write RED tests for weighted choice**

```ts
it('uses injected randomness deterministically', () => {
  const candidates = [
    { value: 'rare', weight: 4 },
    { value: 'common', weight: 1 },
  ];
  expect(chooseWeighted(candidates, () => 0)).toBe('rare');
  expect(chooseWeighted(candidates, () => 0.99)).toBe('common');
});

it('keeps heavily practiced opponent branches selectable but lower weighted', () => {
  expect(opponentResponseWeight({ destinationAttempts: 0, sessionExposure: 0 }))
    .toBeGreaterThan(opponentResponseWeight({ destinationAttempts: 8, sessionExposure: 2 }));
  expect(opponentResponseWeight({ destinationAttempts: 100, sessionExposure: 10 })).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Implement exact opponent weighting**

Use the simple explainable formula:

```ts
export function opponentResponseWeight({ destinationAttempts, sessionExposure }: {
  destinationAttempts: number;
  sessionExposure: number;
}): number {
  return 1 / (1 + Math.max(0, destinationAttempts) + Math.max(0, sessionExposure) * 2);
}
```

`chooseWeighted` sums positive weights, multiplies `random()` by total, walks cumulative weight, and returns the last candidate only as floating-point fallback. Throw on an empty list or non-positive total.

- [ ] **Step 3: Write RED tests for Quick Recall weakness weighting**

```ts
it('favors unseen, wrong, hinted, and slow positions', () => {
  const solid = quickRecallWeight({ attempts: 8, incorrect: 0, hintedAttempts: 0, slowAttempts: 0 });
  expect(quickRecallWeight({ attempts: 0, incorrect: 0, hintedAttempts: 0, slowAttempts: 0 })).toBeGreaterThan(solid);
  expect(quickRecallWeight({ attempts: 8, incorrect: 4, hintedAttempts: 0, slowAttempts: 0 })).toBeGreaterThan(solid);
  expect(quickRecallWeight({ attempts: 8, incorrect: 0, hintedAttempts: 4, slowAttempts: 0 })).toBeGreaterThan(solid);
  expect(quickRecallWeight({ attempts: 8, incorrect: 0, hintedAttempts: 0, slowAttempts: 4 })).toBeGreaterThan(solid);
});
```

- [ ] **Step 4: Implement exact Quick Recall weighting**

```ts
export function quickRecallWeight(input: {
  attempts: number;
  incorrect: number;
  hintedAttempts: number;
  slowAttempts: number;
}): number {
  if (input.attempts === 0) return 7;
  const attempts = Math.max(1, input.attempts);
  return 1
    + (input.incorrect / attempts) * 4
    + (input.hintedAttempts / attempts) * 2
    + (input.slowAttempts / attempts) * 2;
}
```

This is intentionally not date-based and stores no scheduling timestamps.

- [ ] **Step 5: Write RED speed-feedback tests and implement the 5-second soft target**

Tests:

```ts
expect(getSpeedFeedback(3_800)).toEqual({ targetMs: 5_000, status: 'good', label: 'Good speed' });
expect(getSpeedFeedback(8_400)).toEqual({ targetMs: 5_000, status: 'slow', label: 'Target under 5s' });
```

Implementation must never change correctness; it only returns display metadata.

- [ ] **Step 6: Run tests and commit**

```bash
npm test -- src/openings/training/selectors.test.ts src/openings/training/speed.test.ts
npm test
npm run typecheck
git add src/openings/training
git commit -m "feat: add opening training selection policies"
```

---

### Task 6: Build the Practice Line and Quick Recall Engine

**Files:**
- Modify: `src/openings/training/types.ts`
- Create: `src/openings/training/engine.ts`
- Create: `src/openings/training/engine.test.ts`
- Modify: `src/services/openingTrainingService.ts`
- Modify: `src/services/openingTrainingService.test.ts`

**Interfaces:**
- Consumes: `RepertoireTrainingSnapshot`, `TrainingRepository`, `chooseWeighted`, weighting helpers, `getSpeedFeedback`, `ChessGame`.
- Produces:

```ts
export type OpeningTrainingMode = 'practice-line' | 'quick-recall';
export type PromptPhase =
  | 'awaiting-move'
  | 'retry'
  | 'revealed'
  | 'resolved-not-persisted'
  | 'complete';

export type OpeningTrainingFeedback = {
  kind: 'preferred' | 'alternative' | 'incorrect' | 'revealed' | 'storage-error';
  message: string;
  preferredSan?: string;
  explanation?: string;
  decisionTimeMs?: number;
  speed?: SpeedFeedback;
};

export type OpeningTrainingState = {
  mode: OpeningTrainingMode;
  repertoireId: EntityId;
  repertoireName: string;
  learnerSide: 'w' | 'b';
  fen: string;
  phase: PromptPhase;
  progress: { completed: number; total: number | null };
  hintCount: number;
  hintText?: string;
  feedback?: OpeningTrainingFeedback;
  complete: boolean;
};

export type OpeningTrainingEngineOptions = {
  snapshot: RepertoireTrainingSnapshot;
  repository: TrainingRepository;
  mode: OpeningTrainingMode;
  now?: () => number;
  random?: () => number;
  targetDecisionMs?: number;
  quickRecallSize?: number;
};

export class OpeningTrainingEngine {
  static async start(options: OpeningTrainingEngineOptions): Promise<OpeningTrainingEngine>;
  state(): OpeningTrainingState;
  requestHint(): OpeningTrainingState;
  submitMove(move: TrainingMoveInput): Promise<OpeningTrainingState>;
  retryPersistence(): Promise<OpeningTrainingState>;
  stop(): Promise<void>;
}
```

Add to `OpeningTrainingService`:

```ts
startSession(input: {
  repertoireId: EntityId;
  mode: OpeningTrainingMode;
  now?: () => number;
  random?: () => number;
}): Promise<OpeningTrainingEngine>;
```

- [ ] **Step 1: Write RED engine startup tests**

Practice Line requirements:

```ts
it('starts at the graph root and auto-plays opponent turns for a Black repertoire', async () => {
  const engine = await OpeningTrainingEngine.start({ snapshot: blackSnapshot, repository, mode: 'practice-line', random: () => 0 });
  expect(engine.state().learnerSide).toBe('b');
  expect(new ChessGame(engine.state().fen).snapshot().turn).toBe('b');
});
```

Quick Recall requirements:

```ts
it('chooses a trainable learner position using weakness weighting', async () => {
  const engine = await OpeningTrainingEngine.start({ snapshot, repository, mode: 'quick-recall', random: () => 0 });
  expect(engine.state().mode).toBe('quick-recall');
  expect(engine.state().progress.total).toBe(Math.min(10, trainableCount));
});
```

- [ ] **Step 2: Build a graph index from the snapshot**

Inside `engine.ts`, derive maps once:

```ts
const positionById = new Map(snapshot.positions.map((position) => [position.id, position]));
const edgeById = new Map(snapshot.moveEdges.map((edge) => [edge.id, edge]));
const repertoireMovesByPosition = new Map<EntityId, OpeningMoveChoice[]>();
```

Find root candidates as source positions in repertoire moves that are never a destination inside that repertoire. Require exactly one root for Practice Line; otherwise throw a clear repertoire-data error.

For every learner position, require exactly one `preferred: true` learner move and at least one learner move.

- [ ] **Step 3: Implement deterministic opponent auto-response**

At an opponent turn, gather outgoing `role: 'opponent'` choices. Weight each with destination position mastery attempts plus a session-local exposure counter:

```ts
const weight = opponentResponseWeight({
  destinationAttempts: positionMasteryById.get(choice.toPosition.id)?.attempts ?? 0,
  sessionExposure: opponentExposure.get(choice.repertoireMove.id) ?? 0,
});
```

Select through injected `random`, increment session exposure, apply the canonical edge move with `ChessGame.move()`, and continue until a learner turn or endpoint.

If no valid repertoire continuation exists when an opponent move is expected, throw a data error; never substitute an arbitrary legal chess move.

- [ ] **Step 4: Implement Quick Recall candidate scoring without replacement**

For each `RepertoirePosition.trainable === true`, aggregate that position's attempts:

```ts
const positionAttempts = snapshot.attempts.filter((attempt) => attempt.positionId === position.id);
const weight = quickRecallWeight({
  attempts: positionAttempts.length,
  incorrect: positionAttempts.filter((attempt) => !attempt.correct).length,
  hintedAttempts: positionAttempts.filter((attempt) => attempt.hintUsed).length,
  slowAttempts: positionAttempts.filter((attempt) => attempt.decisionTimeMs > targetDecisionMs).length,
});
```

Select one weighted position, remove it from the current session pool, and repeat after successful persistence. Total is `Math.min(quickRecallSize, eligiblePositions.length)`.

- [ ] **Step 5: Write RED grading/correction tests**

Cover:

```ts
// preferred first try
expect((await engine.submitMove(preferredMove)).feedback?.kind).toBe('preferred');

// accepted alternative first try
expect((await engine.submitMove(alternativeMove)).feedback?.kind).toBe('alternative');

// first wrong legal move
expect((await engine.submitMove(wrongLegalMove)).phase).toBe('retry');

// second wrong legal move
expect((await engine.submitMove(secondWrongLegalMove)).phase).toBe('revealed');
expect(engine.state().feedback?.preferredSan).toBe('Nf3');

// revealed answer is not auto-played
expect(engine.state().fen).toBe(originalPromptFen);
```

Illegal moves return unchanged state and do not increment wrong-attempt count or produce a durable attempt.

- [ ] **Step 6: Implement first-response timing and guided correction state**

When a learner prompt is created, store `promptStartedAtMs = now()`.

On the first legal submitted move, freeze:

```ts
firstSubmittedMoveKey = derivedMoveKey;
firstDecisionTimeMs = Math.max(0, now() - promptStartedAtMs);
```

Do not overwrite those values on correction retries.

First wrong legal move → `retry`. Second and later wrong legal moves → `revealed` with preferred SAN and explanation. The learner must submit an accepted move before persistence begins.

- [ ] **Step 7: Implement progressive hints without exposing comments before request**

`requestHint()` increments `hintCount`.

Hint 1:

```ts
const pieceName = pieceLabel(game.pieceAt(preferred.moveEdge.from)?.type);
hintText = preferred.repertoireMove.explanation
  ? `${pieceName} move. ${preferred.repertoireMove.explanation}`
  : `Consider a ${pieceName} move.`;
```

Hint 2 and beyond:

```ts
hintText = `Preferred move: ${preferred.moveEdge.san}`;
```

Before a hint or resolved attempt, do not expose `repertoireMove.explanation` in `OpeningTrainingState`.

- [ ] **Step 8: Write RED persistence-quality and retry tests**

The final accepted move should produce input equivalent to:

```ts
expect(repository.recordAttempt).toHaveBeenCalledWith(expect.objectContaining({
  attemptId: expect.any(String),
  expectedMove: preferredEdge.moveKey,
  actualMove: firstSubmittedEdge.moveKey,
  correct: false, // because the first legal response was wrong
  repertoireMoveId: acceptedCorrection.repertoireMove.id,
  hintCount: 1,
  hintUsed: true,
  decisionTimeMs: firstDecisionTimeMs,
  mode: 'opening:practice-line',
}));
```

Simulate `recordAttempt` throwing once, assert `phase === 'resolved-not-persisted'`, then call `retryPersistence()` and assert the exact same `attemptId` is reused and the prompt advances once.

- [ ] **Step 9: Implement persistence-before-advance and session completion**

Create one durable `TrainingSession` when the engine starts. On accepted resolution:

1. Build one stable `RecordAttemptInput` with `attemptId: createId()`.
2. Call `recordAttempt()`.
3. On failure, cache that input and hold the board/feedback in `resolved-not-persisted`.
4. On success, increment progress and advance Practice Line or Quick Recall.
5. If endpoint/target reached, call `completeSession(sessionId, new Date().toISOString())` and set `complete: true`.

`retryPersistence()` only replays the cached write; it must not recalculate timing, grading, or IDs.

- [ ] **Step 10: Add service session factory and tests**

In `OpeningTrainingService.startSession()`, load the snapshot and delegate to `OpeningTrainingEngine.start()` with the repository dependency and injected clock/random.

- [ ] **Step 11: Run focused and full verification**

```bash
npm test -- src/openings/training/engine.test.ts src/services/openingTrainingService.test.ts
npm test
npm run typecheck
```

Expected: all PASS.

- [ ] **Step 12: Commit**

```bash
git add src/openings/training src/services/openingTrainingService.ts src/services/openingTrainingService.test.ts
git commit -m "feat: add opening practice session engine"
```

---

### Task 7: Build the Training Home and PGN Import Wizard

**Files:**
- Create: `src/utils/readFileText.ts`
- Modify: `src/components/TrainingDataPanel.tsx`
- Create: `src/components/OpeningTrainingHome.tsx`
- Create: `src/components/OpeningTrainingHome.test.tsx`
- Create: `src/components/PgnImportPanel.tsx`
- Create: `src/components/PgnImportPanel.test.tsx`
- Create: `src/openingTraining.css`

**Interfaces:**
- Consumes: `OpeningTrainingService` import/list/demo methods.
- Produces:

```ts
export type TrainingLaunchRequest = {
  repertoireId: EntityId;
  mode: OpeningTrainingMode;
};

export function OpeningTrainingHome(props: {
  service?: OpeningTrainingService;
  onLaunch: (request: TrainingLaunchRequest) => void;
  onImport: () => void;
}): JSX.Element;

export function PgnImportPanel(props: {
  service?: OpeningTrainingService;
  onImported: (repertoire: Repertoire) => void;
  onCancel: () => void;
}): JSX.Element;
```

- [ ] **Step 1: Extract the existing cross-environment file reader**

Create:

```ts
export async function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read file.'));
    reader.readAsText(file);
  });
}
```

Replace the private duplicate in `TrainingDataPanel.tsx` with this helper. Run the existing `TrainingDataPanel.test.tsx`; expected no behavior change.

- [ ] **Step 2: Write RED Training Home tests**

Assert the home:

- lists non-archived repertoires,
- exposes `Practice Line` as primary and `Quick Recall` as secondary for a selected repertoire,
- offers `Try Demo`,
- calls `ensureDemoRepertoire()` before launching the demo,
- exposes `Import PGN`.

Example:

```ts
await user.click(screen.getByRole('button', { name: /try demo/i }));
expect(service.ensureDemoRepertoire).toHaveBeenCalledTimes(1);
expect(onLaunch).toHaveBeenCalledWith({ repertoireId: DEMO_REPERTOIRE_ID, mode: 'practice-line' });
```

- [ ] **Step 3: Implement the Training Home**

Use `getBrowserOpeningTrainingService()` when no service prop is injected. On mount, call `listRepertoires()`. Filter `archived === false`. Keep the selected repertoire id in component state; do not mutate repertoire data here.

- [ ] **Step 4: Write RED PGN wizard tests**

Cover this exact state progression:

```text
Choose file → parsed game checklist → repertoire name + White/Black → Preview → counts/warnings → Confirm import
```

Tests must assert:

- no `commitImport` call occurs during parse or preview,
- multiple games can be independently checked,
- empty game selection blocks preview,
- preferred-move conflict warnings render before confirmation,
- parse/validation errors render as `role="alert"`,
- confirmation calls `commitImport(plan)` once and then `onImported(repertoire)`.

- [ ] **Step 5: Implement the import wizard as explicit UI state**

Use states such as:

```ts
type ImportStage = 'file' | 'select' | 'preview' | 'saving';
```

Store the parsed `ParsedPgnDocument` separately from `RepertoireImportPlan`. The `Preview import` action calls `service.previewImport()` only. The `Create repertoire` action calls `service.commitImport()`.

For game labels, prefer `Event`, then `White vs Black`, then `Game ${index + 1}`. Preserve source indexes; do not reorder selected games.

- [ ] **Step 6: Add focused responsive styling**

In `openingTraining.css`, create class-scoped styles for repertoire cards, import game checkboxes, preview count grid, warning/error boxes, and button groups. Under `@media (max-width: 640px)`, make controls single-column and `max-width: 100%`.

- [ ] **Step 7: Run tests**

```bash
npm test -- src/components/TrainingDataPanel.test.tsx src/components/OpeningTrainingHome.test.tsx src/components/PgnImportPanel.test.tsx
npm test
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/utils/readFileText.ts src/components/TrainingDataPanel.tsx src/components/OpeningTrainingHome.tsx src/components/OpeningTrainingHome.test.tsx src/components/PgnImportPanel.tsx src/components/PgnImportPanel.test.tsx src/openingTraining.css
git commit -m "feat: add opening repertoire import ui"
```

---

### Task 8: Build the Focused Opening Trainer UI

**Files:**
- Create: `src/components/OpeningTrainer.tsx`
- Create: `src/components/OpeningTrainer.test.tsx`
- Modify: `src/openingTraining.css`

**Interfaces:**
- Consumes: `OpeningTrainingService.startSession()`, `OpeningTrainingEngine.state()/submitMove()/requestHint()/retryPersistence()`.
- Produces:

```ts
export function OpeningTrainer(props: {
  service?: OpeningTrainingService;
  repertoireId: EntityId;
  mode: OpeningTrainingMode;
  onExit: () => void;
}): JSX.Element;
```

- [ ] **Step 1: Write RED trainer UI tests with a fake engine**

Use a fake engine object rather than IndexedDB. Assert:

```ts
expect(screen.getByText(/your move/i)).toBeInTheDocument();
expect(screen.getByText(/0 \/ 10/)).toBeInTheDocument();
```

Then exercise:

- click/tap and drag move submission calls `engine.submitMove()`;
- first miss renders `Not quite. Look again.`;
- second miss/reveal renders `Try Nf3.` and explanation;
- Hint calls `engine.requestHint()` and renders returned hint only then;
- accepted alternative renders `Correct` plus `Preferred: ...`;
- storage failure renders a Retry button that calls `retryPersistence()`;
- completed session renders summary/exit affordance.

- [ ] **Step 2: Implement a controlled training board**

Use `react-chessboard` with `position: state.fen`, learner orientation from `state.learnerSide`, and move input enabled only for `awaiting-move`, `retry`, or `revealed` phases.

Reuse the Phase 1 promotion pattern locally: if a move requires promotion, ask for `q/r/b/n` before calling `engine.submitMove()`.

Do not show generic legal-move dots that expose a repertoire answer; showing ordinary chess-legal selection is acceptable, but do not highlight the preferred repertoire destination.

- [ ] **Step 3: Render compact feedback and hidden-by-default explanations**

While awaiting the learner, show only prompt/timer/hint button/progress. Render `state.hintText` only after `requestHint()` changes it. Render explanation in feedback after an attempt resolves or is revealed.

Format decision time:

```ts
`${(feedback.decisionTimeMs / 1000).toFixed(1)}s`
```

and speed label from `feedback.speed.label`.

- [ ] **Step 4: Render persistence retry without advancing**

For `phase === 'resolved-not-persisted'`:

```tsx
<div role="alert">Your move was graded, but it could not be saved.</div>
<button type="button" onClick={retry}>Retry save</button>
```

Keep the same board FEN and feedback until retry succeeds.

- [ ] **Step 5: Add desktop/mobile trainer layout**

Desktop: board column plus right training panel. Mobile: header → board → feedback/actions → progress. Ensure `.opening-trainer` and descendants use `min-width: 0` and board wrappers use `width: min(100%, ...)` so 320px does not overflow.

- [ ] **Step 6: Run tests**

```bash
npm test -- src/components/OpeningTrainer.test.tsx
npm test
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/OpeningTrainer.tsx src/components/OpeningTrainer.test.tsx src/openingTraining.css
git commit -m "feat: add opening practice trainer ui"
```

---

### Task 9: Integrate Train / Play / Data Navigation Without Regressing Free Play

**Files:**
- Create: `src/components/PlaySurface.tsx`
- Create: `src/components/AppNav.tsx`
- Create: `src/components/OpeningTrainingPage.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/App.smoke.test.tsx`
- Modify: `src/main.tsx`
- Modify: `src/openingTraining.css`

**Interfaces:**
- Consumes: existing Phase 1 free-play logic, `OpeningTrainingHome`, `PgnImportPanel`, `OpeningTrainer`, Phase 2 `TrainingDataPanel`.
- Produces a top-level `App` with `Train | Play | Data` surfaces and Train as default.

- [ ] **Step 1: Protect current Play behavior before extraction**

Update existing app tests so free-play assertions explicitly navigate to `Play` once navigation exists. Before changing production code, add one future-facing failing test:

```ts
it('opens on Train and preserves the Play and Data surfaces', async () => {
  render(<App openingTrainingService={openingService} trainingDataService={dataService} />);
  expect(screen.getByRole('tab', { name: 'Train' })).toHaveAttribute('aria-selected', 'true');
  await user.click(screen.getByRole('tab', { name: 'Play' }));
  expect(screen.getByLabelText('Chess game')).toBeInTheDocument();
  await user.click(screen.getByRole('tab', { name: 'Data' }));
  expect(screen.getByText(/local training data/i)).toBeInTheDocument();
});
```

Expected: RED.

- [ ] **Step 2: Extract existing free-play code verbatim into `PlaySurface`**

Move the current `ChessGame`, 3+2 clock, move telemetry, promotion picker, board, move list, FEN/PGN panel, Undo/New Game/Flip behavior from `App.tsx` into:

```ts
export function PlaySurface({ initialFen }: { initialFen?: string }) { /* existing behavior */ }
```

Do not alter timing rules, board colors, telemetry, undo, or promotion semantics during this extraction.

Run existing free-play tests immediately; expected PASS after imports/test selectors are adjusted.

- [ ] **Step 3: Add accessible top-level navigation**

`AppNav` accepts:

```ts
type AppSection = 'train' | 'play' | 'data';

export function AppNav({ current, onChange }: {
  current: AppSection;
  onChange: (section: AppSection) => void;
}) { /* tablist */ }
```

Use `role="tablist"`, three `role="tab"` buttons, and `aria-selected`.

- [ ] **Step 4: Compose the Train page**

`OpeningTrainingPage` owns its local subview:

```ts
type TrainView =
  | { kind: 'home' }
  | { kind: 'import' }
  | { kind: 'session'; repertoireId: EntityId; mode: OpeningTrainingMode };
```

Home `onImport` → import view. Home `onLaunch` → session view. Successful import returns to home with the new repertoire selected or immediately available. Trainer exit returns home.

- [ ] **Step 5: Reduce `App` to shell/navigation/composition**

`App` props become:

```ts
type AppProps = {
  initialFen?: string;
  trainingDataService?: TrainingDataService;
  openingTrainingService?: OpeningTrainingService;
};
```

Render:

```tsx
<AppNav current={section} onChange={setSection} />
{section === 'train' && <OpeningTrainingPage service={openingTrainingService} />}
{section === 'play' && <PlaySurface initialFen={initialFen} />}
{section === 'data' && <TrainingDataPanel service={trainingDataService} />}
```

Change the eyebrow to `Phase 3 · Opening training` on Train; Play/Data surfaces may use their own context text.

- [ ] **Step 6: Import the Phase 3 stylesheet in `main.tsx`**

```ts
import './styles.css';
import './trainingData.css';
import './openingTraining.css';
```

If `trainingData.css` is already imported elsewhere, keep exactly one import path; do not duplicate it.

- [ ] **Step 7: Run app regression tests**

```bash
npm test -- src/App.test.tsx src/App.smoke.test.tsx
npm test
npm run typecheck
npm run build
```

Expected: current chess behavior remains green; Train is default; Data is no longer visually mixed into Play.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/App.test.tsx src/App.smoke.test.tsx src/main.tsx src/components/PlaySurface.tsx src/components/AppNav.tsx src/components/OpeningTrainingPage.tsx src/openingTraining.css
git commit -m "feat: integrate train play data navigation"
```

---

### Task 10: Add Real-Browser Phase 3 Coverage, Documentation, and Final Verification

**Files:**
- Create: `src/e2e/openingTraining.spec.ts`
- Modify: `README.md`
- Modify: `.github/workflows/ci.yml` only if existing screenshot selectors/navigation require adjustment; otherwise leave workflow semantics unchanged.

**Interfaces:**
- Consumes: public browser UI only.
- Produces: end-to-end proof that PGN import persists, training records attempts, and mobile layout remains usable.

- [ ] **Step 1: Write a real-browser PGN import → reload test**

Use Playwright `setInputFiles` with an in-memory PGN payload:

```ts
await page.getByRole('button', { name: /import pgn/i }).click();
await page.locator('input[type="file"]').setInputFiles({
  name: 'opening.pgn',
  mimeType: 'application/x-chess-pgn',
  buffer: Buffer.from(`
[Event "E2E A"]
[Result "*"]
1. e4 e5 2. Nf3 Nc6 3. Bc4 *

[Event "E2E B"]
[Result "*"]
1. e4 c5 2. Nf3 d6 *
`),
});
```

Select both games, choose White, name `E2E White`, preview, confirm. Reload the page and assert `E2E White` still appears in Train.

- [ ] **Step 2: Extend the browser test through one Practice Line attempt**

Launch Practice Line for the imported repertoire. Play the known learner move `e2 → e4` through the board. Assert a Correct feedback message appears. Navigate to Data and assert attempts count is at least 1, then reload and ensure the attempt count persists.

Do not inspect IndexedDB directly in this test; exercise public UI behavior.

- [ ] **Step 3: Add Quick Recall browser smoke**

Return to Train, launch Quick Recall, assert header contains `Quick Recall` and progress is visible. Make one known correct move from the loaded prompt if deterministic test data allows; otherwise assert the prompt board renders and session controls are usable. Keep deep weighting correctness in Vitest rather than making Playwright random-sensitive.

- [ ] **Step 4: Add a 320px no-horizontal-overflow Phase 3 test**

```ts
await page.setViewportSize({ width: 320, height: 800 });
await page.goto('/');
await expect(page.getByRole('tab', { name: 'Train' })).toBeVisible();
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
expect(overflow).toBeLessThanOrEqual(0);
```

Navigate into the import screen and trainer where practical, repeating the overflow assertion.

- [ ] **Step 5: Update README with Phase 3 capabilities and boundaries**

Document:

```text
Phase 3 opening training
- Train / Play / Data navigation
- built-in demo repertoire
- multi-game PGN import with nested variations/comments
- White/Black repertoire choice
- Practice Line
- Quick Recall
- guided correction + hints
- preferred/accepted alternatives
- soft 5-second speed target
- browser-local persistence
```

Keep explicit deferred scope: Stockfish, FSRS, full visual repertoire editor, cloud sync, tactics/endgames/post-game review.

- [ ] **Step 6: Run the entire verification matrix**

```bash
npm ci
npm test
npm run typecheck
npm run build
npm run test:e2e
```

Expected:

- all Vitest suites pass,
- TypeScript passes with no errors,
- production Vite build succeeds,
- all Playwright tests pass,
- no horizontal overflow at 320px,
- Phase 1 Play and Phase 2 Data behavior remain accessible.

- [ ] **Step 7: Inspect the production bundle warning but do not expand scope unnecessarily**

If Vite still only reports the pre-existing >500 kB chunk warning, record it as non-blocking. If the PGN parser causes a material regression, lazy-load `PgnImportPanel`/the parser path from Train rather than changing unrelated architecture.

- [ ] **Step 8: Commit**

```bash
git add src/e2e/openingTraining.spec.ts README.md .github/workflows/ci.yml
git commit -m "test: verify phase 3 opening training workflow"
```

If `.github/workflows/ci.yml` did not change, omit it from `git add`.

---

## Final Review Gate

After Task 10, do not merge immediately. Perform these checks on the complete branch:

```bash
git diff --check main...HEAD
npm ci
npm test
npm run typecheck
npm run build
npm run test:e2e
```

Then review the branch against every Phase 3 success criterion:

1. Train is the default top-level surface.
2. Demo repertoire works through the same import/graph path and installs idempotently.
3. Multi-game PGN + nested RAV + comments parse.
4. User can select games, side, name, preview, warnings, and atomically create one repertoire.
5. Conflicting preferred main lines show a deterministic warning/source-order winner.
6. Practice Line auto-plays weighted opponent responses.
7. Preferred and accepted learner moves grade correctly.
8. First miss retries; second miss reveals; learner still makes the answer.
9. Hints remain hidden until requested and are durable through `hintCount`.
10. Soft speed feedback uses 5 seconds without changing correctness.
11. Corrected misses persist as unsuccessful first recall, not a clean success.
12. Failed attempt writes do not advance and retry uses one stable attempt id.
13. Quick Recall favors unseen/wrong/hinted/slow positions with deterministic injectable randomness.
14. Reload retains repertoires, attempts, and mastery.
15. Play and Data still work independently.
16. 320px layout has no horizontal overflow.
17. No Stockfish, FSRS, cloud sync, visual repertoire editor, or existing-repertoire merge slipped into scope.

Open/update the Phase 3 PR only after the branch passes this gate.