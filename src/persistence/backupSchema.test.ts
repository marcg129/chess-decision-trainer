import { FsrsScheduler } from '../review/fsrsAdapter';
import { InvalidChessEdgeError } from '../training/errors';
import {
  InvalidBackupError,
  ReferentialIntegrityError,
  UnsupportedBackupVersionError,
} from './errors';
import { parseAndValidateBackup } from './backupSchema';
import { cloneBackup, makeValidBackup, testId } from './backupTestUtils';

test('accepts a structurally and chess-semantically valid backup', () => {
  const backup = makeValidBackup();
  expect(parseAndValidateBackup(backup)).toEqual(backup);
});

test('rejects wrong format, unsupported version, and malformed UUIDs', () => {
  const wrongFormat = { ...makeValidBackup(), format: 'other-app' };
  expect(() => parseAndValidateBackup(wrongFormat)).toThrow(InvalidBackupError);

  const unsupported = { ...makeValidBackup(), version: 3 };
  expect(() => parseAndValidateBackup(unsupported)).toThrow(
    UnsupportedBackupVersionError,
  );

  const malformed = cloneBackup(makeValidBackup());
  malformed.data.repertoires[0].id = 'not-a-uuid';
  expect(() => parseAndValidateBackup(malformed)).toThrow(InvalidBackupError);
});

test('requires exactly one local learner', () => {
  const none = cloneBackup(makeValidBackup());
  none.data.learnerProfiles = [];
  expect(() => parseAndValidateBackup(none)).toThrow(ReferentialIntegrityError);

  const two = cloneBackup(makeValidBackup());
  two.data.learnerProfiles.push({
    ...two.data.learnerProfiles[0],
    id: testId(99),
    displayName: 'Second learner',
  });
  expect(() => parseAndValidateBackup(two)).toThrow(ReferentialIntegrityError);
});

test('rejects duplicate stable ids and duplicate canonical position keys', () => {
  const duplicateId = cloneBackup(makeValidBackup());
  duplicateId.data.repertoirePositions[1].id = duplicateId.data.repertoirePositions[0].id;
  expect(() => parseAndValidateBackup(duplicateId)).toThrow(ReferentialIntegrityError);

  const duplicatePosition = cloneBackup(makeValidBackup());
  duplicatePosition.data.positions.push({
    ...duplicatePosition.data.positions[0],
    id: testId(98),
  });
  expect(() => parseAndValidateBackup(duplicatePosition)).toThrow(
    ReferentialIntegrityError,
  );
});

test('rejects broken references', () => {
  const backup = cloneBackup(makeValidBackup());
  backup.data.repertoires[0].learnerId = testId(90);
  expect(() => parseAndValidateBackup(backup)).toThrow(ReferentialIntegrityError);
});

test('rejects illegal move edges', () => {
  const backup = cloneBackup(makeValidBackup());
  backup.data.moveEdges[0].to = 'e5';
  expect(() => parseAndValidateBackup(backup)).toThrow(InvalidChessEdgeError);
});

test('rejects a legal move edge whose referenced destination does not match', () => {
  const backup = cloneBackup(makeValidBackup());
  backup.data.moveEdges[0].toPositionId = backup.data.moveEdges[0].fromPositionId;
  expect(() => parseAndValidateBackup(backup)).toThrow(InvalidChessEdgeError);
});


function makeValidV2Backup() {
  const base = makeValidBackup('Phase 4 backup');
  const targetMoveId = base.data.repertoireMoves[0].id;
  const positionId = base.data.positions[0].id;
  const repertoireId = base.data.repertoires[0].id;
  const reviewedAt = new Date('2026-10-01T12:00:00.000Z');
  const scheduled = new FsrsScheduler().schedule(null, 'good', reviewedAt);

  return {
    ...base,
    version: 2,
    schemaVersion: 3,
    data: {
      ...base.data,
      learnerProfiles: base.data.learnerProfiles.map((learner) => ({
        ...learner,
        reviewSettings: { newItemsPerDay: 12, batchSize: 20 },
      })),
      repertoireMoveMastery: [
        {
          id: testId(20),
          repertoireMoveId: targetMoveId,
          attempts: 1,
          correct: 1,
          incorrect: 0,
          streak: 1,
          averageDecisionTimeMs: 1800,
          lastAttemptedAt: reviewedAt.toISOString(),
          state: 'new',
          score: 0,
          nextReviewAt: scheduled.nextReviewAt,
          schedulingData: scheduled.schedulingData,
          updatedAt: reviewedAt.toISOString(),
        },
      ],
      trainingAttempts: [
        {
          id: testId(21),
          timestamp: reviewedAt.toISOString(),
          repertoireId,
          positionId,
          repertoireMoveId: targetMoveId,
          expectedMove: base.data.moveEdges[0].moveKey,
          actualMove: base.data.moveEdges[0].moveKey,
          correct: true,
          decisionTimeMs: 1800,
          hintCount: 0,
          hintUsed: false,
          mode: 'opening:review-due',
          review: {
            targetRepertoireMoveId: targetMoveId,
            rating: 'good',
            kind: 'scheduled',
            schedulingApplied: true,
            newCard: true,
          },
          masteryBefore: {
            positionState: 'new',
            positionScore: 0,
            repertoireMoveState: 'new',
            repertoireMoveScore: 0,
          },
          masteryAfter: {
            positionState: 'new',
            positionScore: 0,
            repertoireMoveState: 'new',
            repertoireMoveScore: 0,
          },
        },
      ],
    },
  };
}

test('accepts a valid V2 backup with review settings, review metadata, and FSRS scheduling', () => {
  const backup = makeValidV2Backup();
  expect(parseAndValidateBackup(backup)).toEqual(backup);
});

test('rejects V2 review metadata that targets a missing repertoire move', () => {
  const backup = makeValidV2Backup();
  backup.data.trainingAttempts[0].review.targetRepertoireMoveId = testId(99);
  expect(() => parseAndValidateBackup(backup)).toThrow(ReferentialIntegrityError);
});

test('rejects V2 mastery with malformed or unsupported FSRS scheduling data', () => {
  const malformed = makeValidV2Backup();
  malformed.data.repertoireMoveMastery[0].schedulingData = {
    ...malformed.data.repertoireMoveMastery[0].schedulingData,
    schedulingSchemaVersion: 9,
  };
  expect(() => parseAndValidateBackup(malformed)).toThrow(/scheduling|schema/i);
});

test('rejects future backup versions while accepting both V1 and V2', () => {
  expect(parseAndValidateBackup(makeValidBackup()).version).toBe(1);
  expect(parseAndValidateBackup(makeValidV2Backup()).version).toBe(2);

  expect(() =>
    parseAndValidateBackup({ ...makeValidV2Backup(), version: 3 }),
  ).toThrow(UnsupportedBackupVersionError);
});
