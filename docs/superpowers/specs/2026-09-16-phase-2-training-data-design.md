# Phase 2 Training Data and Local Persistence Design

## Objective

Build the durable local training-data foundation for the Chess Decision Trainer so later opening practice, adaptive review, mistake recycling, and analytics can depend on stable persisted data rather than component state.

Phase 2 adds a typed training domain, a transposition-aware repertoire graph, layered mastery, append-only training-attempt history, and IndexedDB persistence through Dexie behind repository interfaces. It also adds safe versioned backup/restore and reset utilities.

Phase 2 intentionally does **not** build the actual opening-training workflow, repertoire editor, FSRS scheduling algorithm, Stockfish integration, cloud accounts, cloud sync, or merge/conflict resolution.

## Product decisions already approved

1. **One local learner profile, multiple repertoires.** The initial browser instance represents one learner, but that learner may maintain separate repertoires such as White, Black vs 1.e4, Black vs 1.d4, experimental repertoires, and future study sets.
2. **Position graph, not move tree.** Canonical chess positions are shared nodes. Move-order transpositions converge on the same node rather than creating duplicate branches.
3. **Layered mastery.** General familiarity with a canonical position is stored separately from repertoire-specific mastery of the move/context the learner intends to know there.
4. **Full attempt history.** Every training response is preserved as an immutable event. Current mastery records are maintained as fast derived snapshots rather than replacing historical evidence.
5. **Local persistence now, cloud later.** Phase 2 uses IndexedDB through Dexie and deliberately avoids cloud identity/sync complexity.
6. **Restore/replace imports only.** A backup import replaces current local training data after full validation and pre-restore backup. True merge/conflict handling is deferred until sync exists.
7. **Infrastructure-focused UI.** Phase 2 exposes only lightweight data inspection, backup, restore, and reset utilities. The actual trainer and repertoire authoring UI begin in later phases.

## Identity conventions

Application entity IDs are stable UUID strings generated at the domain boundary, not storage-layer auto-increment IDs. Backup/restore preserves these IDs exactly.

Chess-position identity remains separate: the normalized `positionKey` is the canonical chess identity used for deduplication, while the UUID is the application/database identity used by relationships.

## Critical prerequisite: position identity correctness

Phase 2 makes the Phase 1 normalized `positionKey` a unique canonical identity. That means its semantics must exactly match the approved Phase 1 specification before any persisted data relies on it.

The normalized training position key must include:

- piece placement
- side to move
- castling rights
- the en-passant target square **only when a legal en-passant capture is actually available**

Halfmove and fullmove counters remain excluded.

The current Phase 1 implementation keeps the first four FEN fields verbatim, which means an ineffective en-passant target can incorrectly create a second training identity for the same practical position. Phase 2 implementation must correct this first, under tests, before introducing uniqueness constraints on persisted positions.

Full FEN remains preserved separately for exact reconstruction and rules-sensitive state.

## Architecture

Phase 1 remains the authoritative chess-state layer. Persistence must not leak into `ChessGame`, the chess clock, or move legality logic.

The new structure is:

```text
Chess Core
    ↓
Training Domain
    ↓
Repository Interfaces
    ↓
IndexedDB / Dexie
```

### Training domain

The training domain owns plain TypeScript entities and domain rules for:

- canonical positions
- canonical move edges
- repertoires
- repertoire membership/context
- position mastery
- repertoire-move mastery
- training sessions and attempts
- backup payloads

The training domain must not import Dexie.

### Repository boundary

Application and training logic interact with persistence through interfaces. Representative operations include:

```text
savePosition(...)
getPosition(...)
getOrCreateMoveEdge(...)
saveRepertoire(...)
getRepertoireGraph(...)
recordAttempt(...)
getPositionMastery(...)
getRepertoireMoveMastery(...)
exportBackup(...)
restoreBackup(...)
resetTrainingData(...)
```

Repository contracts should express domain concepts rather than Dexie table operations.

### Dexie persistence

Dexie is the only module allowed to access IndexedDB directly. It owns:

- table definitions
- indexes
- schema versions
- migrations
- transactions
- persistence-specific errors

UI and training code must not call Dexie tables directly.

## Canonical position graph

### Position

A canonical chess position record contains at minimum:

- stable UUID
- unique normalized `positionKey`
- representative full FEN
- side to move
- created timestamp
- updated timestamp

`positionKey` is the chess-position identity. The UUID is the database identity. They are deliberately separate concepts.

The representative FEN exists to reconstruct/display a legal board state for that canonical node. Because canonical identity intentionally ignores halfmove/fullmove counters, the representative FEN must not be treated as a preserved historical game state or as evidence for draw-history adjudication.

### MoveEdge

A canonical move edge contains at minimum:

- stable UUID
- source position ID
- destination position ID
- source square
- destination square
- promotion piece when applicable
- UCI/LAN-like move representation
- SAN
- created timestamp

A move edge is unique by source canonical position plus normalized move identity. The same chess move should not be duplicated simply because multiple repertoires reference it.

Move-edge creation must use the Phase 1 chess domain to verify that the move is legal from the source position and that applying it yields the destination position's normalized `positionKey`. The repository must not accept an internally inconsistent source/move/destination relationship as a valid graph edge.

### Transposition behavior

If two legal move orders reach the same normalized `positionKey`, both paths must converge on the same `Position` record.

This is a core acceptance requirement because later training history must not fragment across duplicate representations of the same practical chess position.

## Learner and repertoire model

### LearnerProfile

Phase 2 supports exactly one local learner profile. It contains at minimum:

- stable UUID
- display name or local label
- created timestamp
- updated timestamp

The schema may remain future-compatible with multiple learners, but Phase 2 must not add account switching or multi-user UI.

### Repertoire

A repertoire contains at minimum:

- stable UUID
- learner ID
- name
- intended side: White, Black, or mixed
- optional description
- archived flag
- created timestamp
- updated timestamp

Multiple repertoires may reference the same canonical positions and move edges.

### RepertoirePosition

A repertoire-position membership record contains at minimum:

- stable UUID
- repertoire ID
- canonical position ID
- trainable flag
- optional notes
- optional tags
- optional priority
- created/updated timestamps

The pair `(repertoireId, positionId)` must be unique.

### RepertoireMove

A repertoire move links repertoire-specific meaning to a canonical move edge. It contains at minimum:

- stable UUID
- repertoire ID
- move edge ID
- role: learner move, opponent response, or accepted alternative
- preferred/primary flag where applicable
- optional ordering/priority
- optional explanation
- created/updated timestamps

A repertoire move must never duplicate the underlying chess move merely to add repertoire-specific metadata.

## Layered mastery

### PositionMastery

Shared position mastery represents the learner's general familiarity with a canonical position regardless of which repertoire or move order reached it.

It should support at minimum:

- stable UUID
- canonical position ID
- total exposures/attempts
- correct count
- incorrect count
- aggregate or recent decision-time metrics
- last seen timestamp
- mastery state/value
- reserved scheduling metadata for future adaptive review
- updated timestamp

The exact adaptive algorithm is deferred. Phase 2 should persist stable fields that later scheduling logic can update without changing identity relationships.

### RepertoireMoveMastery

Repertoire-specific mastery represents whether the learner knows the intended move/context in a particular repertoire.

It should support at minimum:

- stable UUID
- repertoire move ID
- attempts
- correct count
- incorrect count
- current streak or recent-success state
- speed metrics
- current mastery state/value
- last attempted timestamp
- reserved scheduling metadata for future adaptive review
- updated timestamp

Position mastery and repertoire-move mastery must remain distinct records. Knowing a position generally must not automatically imply knowledge of every repertoire choice associated with it.

## Training history

### TrainingSession

A lightweight session record may be created for grouped practice and contains at minimum:

- stable UUID
- optional repertoire ID
- mode identifier
- started timestamp
- optional completed timestamp

Phase 2 does not require a session UI, but session identity enables later analytics without inferring sessions from timestamps.

### TrainingAttempt

Every drill response is stored as an immutable attempt event. It contains at minimum:

- stable UUID
- timestamp
- optional session ID
- repertoire ID
- canonical position ID
- optional repertoire move/context ID
- expected move
- actual move
- correct/incorrect result
- decision time in milliseconds
- hint count
- whether a hint was used
- training mode identifier
- relevant mastery value/state before the attempt
- relevant mastery value/state after the attempt

Attempt history is append-only in normal operation. Mastery records are mutable snapshots derived/updated from attempts for fast reads.

## Atomic write rules

### Record-attempt transaction

Recording a training response must atomically:

1. append the `TrainingAttempt`
2. update `PositionMastery`
3. update `RepertoireMoveMastery` when applicable
4. update relevant timestamps/session state when required

The transaction must not permit mastery to update without the attempt record, or the attempt to persist without its required mastery update.

### Graph/repertoire mutation transaction

Operations that create or link positions, move edges, repertoire positions, and repertoire moves as one logical change must commit atomically.

Partial repertoire graph writes are not acceptable.

## IndexedDB/Dexie schema behavior

Dexie schema versions must be explicit. Schema changes must use forward migrations rather than deleting user data.

Important indexes should support at least:

- unique position lookup by `positionKey`
- move-edge lookup by source position + move identity
- repertoire lookup by learner
- repertoire-position lookup by repertoire and position
- repertoire-move lookup by repertoire and move edge
- attempts by timestamp
- attempts by repertoire
- attempts by position
- attempts by session
- mastery lookup by its natural context key

Migration code must remain centralized in the persistence module.

## Backup format

Backups use a versioned JSON envelope independent from the Dexie database version.

The top-level structure contains at minimum:

- format identifier
- backup format version
- exported timestamp
- application/schema metadata
- learner profile
- repertoires
- canonical positions
- move edges
- repertoire-position records
- repertoire-move records
- position-mastery records
- repertoire-move-mastery records
- training sessions
- training attempts

Separating backup format version from IndexedDB schema version allows storage internals to evolve without automatically invalidating old exported backups.

## Backup validation

Imported JSON is untrusted external data and must undergo runtime validation before any mutation.

Use a runtime schema validator at the boundary. Validation must cover:

- top-level format identifier
- supported backup version
- required field types
- stable-UUID uniqueness
- unique position-key constraints
- referential integrity between all related records
- valid repertoire/move roles and enums
- mastery references
- attempt references
- chess-graph semantics for every `MoveEdge`: the move must be legal from the source representative FEN and must normalize to the referenced destination `positionKey`

A syntactically valid JSON file with broken references or impossible move edges must still be rejected.

## Restore/replace flow

Phase 2 supports full restore/replace only.

Required sequence:

1. Parse the candidate file.
2. Validate the complete backup without changing current data.
3. Produce a human-readable summary such as repertoire, position, and attempt counts.
4. Require explicit user confirmation that current local training data will be replaced.
5. Create an automatic pre-restore backup of the current dataset.
6. Begin one transaction covering all replaceable training-data tables.
7. Clear current replaceable user data.
8. Insert the imported dataset while preserving stable IDs.
9. Run final referential/integrity checks.
10. Commit only if all steps succeed.

If the restore transaction fails, the original data must remain intact.

The automatic pre-restore backup should remain available as a recovery point after successful replacement and should be downloadable from the utility UI.

True merge, duplicate reconciliation, and sync conflict resolution are explicitly deferred.

## Reset behavior

Reset must:

- require explicit confirmation
- clear learner/training data transactionally
- preserve the IndexedDB database and schema itself
- leave the application capable of recreating a clean default learner state

Phase 2 should not delete the IndexedDB database wholesale as its normal reset mechanism.

## Error model

Raw Dexie errors must not leak directly into UI code.

The repository/persistence boundary should expose typed application failures including at least:

- invalid backup
- unsupported backup version
- referential-integrity failure
- invalid chess-graph edge
- storage unavailable
- quota/storage failure
- migration failure
- transaction failure
- restore failure
- reset failure

Destructive operations must fail safely and preserve existing user data whenever possible.

## Phase 2 utility UI

Add a small Training Data management surface capable of:

- showing the active local learner profile
- listing repertoires
- showing basic stored counts for repertoires, positions, move edges, mastery records, sessions, and attempts
- showing approximate last activity
- exporting a complete versioned JSON backup
- selecting and validating a backup for restore
- showing an import summary before confirmation
- performing confirmed restore/replace
- downloading the automatic pre-restore backup when available
- resetting local training data behind explicit confirmation
- optionally displaying current database/schema version for debugging

Phase 2 must not add:

- repertoire authoring workflow
- opening line editor
- move-tree/graph visualization
- opening drills
- mastery dashboard
- adaptive queue UI

Those belong to later phases.

## Testing strategy

### Position identity prerequisite tests

Before persistence is introduced:

- effective legal en-passant target is preserved in the normalized key
- ineffective en-passant target normalizes to `-`
- equivalent positions that differ only by halfmove/fullmove counters share a key
- equivalent transposed move orders share a key
- full FEN remains unchanged and available separately

### Domain tests

Required coverage:

- canonical positions deduplicate by normalized `positionKey`
- canonical move edges deduplicate by source position + move
- illegal move edge is rejected
- move edge whose destination does not match the applied move is rejected
- transposed repertoire lines converge on one canonical position
- multiple repertoires may reference the same canonical position independently
- multiple repertoires may reference the same canonical move edge independently
- position mastery and repertoire-move mastery remain separate
- attempts preserve all required context

### Persistence/integration tests

Required coverage:

- create/read/update each repository entity
- data survives closing/reopening the persistence layer
- recording attempt + mastery updates is atomic
- failed attempt transaction leaves no partial attempt or mastery update
- graph/repertoire mutations are atomic
- schema migration preserves existing records
- export -> clear -> restore reproduces the same logical dataset
- invalid import changes nothing
- unsupported backup version changes nothing
- referentially invalid backup changes nothing
- chess-semantically invalid backup changes nothing
- failed restore rolls back fully
- automatic pre-restore backup is created before replacement
- reset clears user data without corrupting the database/schema

Use an IndexedDB test environment compatible with Vitest so repository tests exercise real IndexedDB-style behavior rather than mocking repository methods away.

### UI tests

At minimum:

- training-data summary renders
- export action produces a backup payload/file
- invalid import surfaces validation failure
- restore requires explicit confirmation
- restore summary displays counts before replacement
- successful restore refreshes displayed counts
- reset requires confirmation
- storage/restore failures surface understandable application errors

### Browser persistence smoke

CI or equivalent browser smoke verification must:

1. create/seed a tiny local training dataset
2. reload the application
3. verify the persisted records remain available

This is the final proof that Phase 2 delivered real local persistence rather than only repository abstractions.

## Phase 2 acceptance criteria

Phase 2 is complete when all of the following are true:

1. One local learner can own multiple repertoires.
2. Repertoires share a canonical position graph.
3. Transpositions do not duplicate canonical positions.
4. The normalized position identity correctly ignores ineffective en-passant targets before becoming a persisted unique key.
5. Canonical move edges are shared across repertoires when the underlying chess move/context is the same.
6. Every canonical move edge is legal from its source and resolves to its referenced destination position.
7. Shared position mastery and repertoire-specific move mastery are distinct.
8. Full training-attempt history is persisted with session/context/timing data.
9. Data survives browser reloads through IndexedDB.
10. All persistence is accessed through repository interfaces rather than direct Dexie use from UI/training code.
11. Attempt/mastery updates and graph mutations are transactional.
12. Export produces a complete versioned backup.
13. Import validates the full backup before mutation, including chess-graph semantics.
14. Restore creates a pre-restore backup and replaces current data atomically.
15. Invalid or failed restores leave existing data unchanged.
16. Reset safely clears user training data while preserving the database/schema.
17. Automated tests cover identity, graph deduplication, graph legality, mastery separation, transactions, migrations, persistence, backup/restore, and UI failure states.
18. TypeScript checks, tests, production build, and browser persistence smoke pass.
19. Phase 2 introduces no opening trainer, FSRS scheduling algorithm, Stockfish, accounts, cloud sync, or merge/conflict engine.

## Explicitly deferred

- opening repertoire authoring UI
- opening training/drill UI
- FSRS or other adaptive scheduling logic
- engine evaluation and Stockfish
- puzzle system
- AI coaching prose
- cloud accounts
- cloud database
- multi-device sync
- backup merge/conflict resolution
- public/shared repertoires
- mastery dashboard

## Deliverable

A tested local training-data platform that can safely persist multiple transposition-aware repertoires, layered mastery, and complete attempt history, and that can be backed up and restored without data loss. Phase 3 can then focus on building the first useful opening-training experience on top of this stable foundation rather than inventing persistence while building the trainer.
