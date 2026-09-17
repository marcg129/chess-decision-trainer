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

  const unsupported = { ...makeValidBackup(), version: 2 };
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
