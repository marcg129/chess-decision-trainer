import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChessGame } from '../../core/game';
import { ChessTrainingDatabase } from '../../persistence/db';
import { DexieTrainingRepository } from '../../persistence/dexieTrainingRepository';
import { OpeningTrainingService } from '../../services/openingTrainingService';
import type { TrainingMoveInput } from '../../training/types';
import { OpeningTrainingEngine } from './engine';

const databases: ChessTrainingDatabase[] = [];

async function setupRepertoire(input: { pgn: string; side: 'white' | 'black'; name?: string }) {
  const db = new ChessTrainingDatabase(`engine-${crypto.randomUUID()}`);
  databases.push(db);
  const repository = new DexieTrainingRepository(db);
  const service = new OpeningTrainingService(repository);
  const plan = service.previewImport({
    document: service.parsePgn(input.pgn),
    name: input.name ?? 'Engine fixture',
    side: input.side,
    selectedGameIndexes: service.parsePgn(input.pgn).games.map((game) => game.index),
  });
  const repertoire = await service.commitImport(plan);
  return {
    db,
    repository,
    service,
    repertoire,
    snapshot: await service.loadRepertoire(repertoire.id),
  };
}

const WHITE_PGN = `
[Event "Primary"]
[Result "*"]
1. e4 {Claim central space.} e5 2. Nf3 Nc6 3. Bc4 *

[Event "Alternative"]
[Result "*"]
1. d4 d5 2. c4 *
`;

const move = (from: TrainingMoveInput['from'], to: TrainingMoveInput['to']): TrainingMoveInput => ({ from, to });

afterEach(async () => {
  vi.restoreAllMocks();
  while (databases.length) {
    const db = databases.pop();
    if (db) await db.delete();
  }
});

describe('OpeningTrainingEngine', () => {
  it('starts Practice Line at the root and auto-plays opponent turns for a Black repertoire', async () => {
    const fixture = await setupRepertoire({
      pgn: '[Event "Black"]\n[Result "*"]\n1. e4 e5 2. Nf3 Nc6 *',
      side: 'black',
    });
    const engine = await OpeningTrainingEngine.start({
      snapshot: fixture.snapshot,
      repository: fixture.repository,
      mode: 'practice-line',
      random: () => 0,
      now: () => 1_000,
    });

    expect(engine.state().learnerSide).toBe('b');
    expect(new ChessGame(engine.state().fen).snapshot().turn).toBe('b');
    expect(engine.state().phase).toBe('awaiting-move');
  });

  it('starts Quick Recall with a weakness-selected trainable position and no duplicate target padding', async () => {
    const fixture = await setupRepertoire({ pgn: WHITE_PGN, side: 'white' });
    const trainableCount = fixture.snapshot.repertoirePositions.filter((position) => position.trainable).length;
    const engine = await OpeningTrainingEngine.start({
      snapshot: fixture.snapshot,
      repository: fixture.repository,
      mode: 'quick-recall',
      random: () => 0,
      now: () => 1_000,
    });

    expect(engine.state().mode).toBe('quick-recall');
    expect(engine.state().progress.total).toBe(Math.min(10, trainableCount));
    expect(engine.state().phase).toBe('awaiting-move');
  });

  it('grades preferred and accepted alternative repertoire moves', async () => {
    const preferredFixture = await setupRepertoire({ pgn: WHITE_PGN, side: 'white', name: 'Preferred' });
    const preferred = await OpeningTrainingEngine.start({
      snapshot: preferredFixture.snapshot,
      repository: preferredFixture.repository,
      mode: 'practice-line',
      random: () => 0,
      now: () => 1_000,
    });
    expect((await preferred.submitMove(move('e2', 'e4'))).feedback?.kind).toBe('preferred');

    const alternativeFixture = await setupRepertoire({ pgn: WHITE_PGN, side: 'white', name: 'Alternative' });
    const alternative = await OpeningTrainingEngine.start({
      snapshot: alternativeFixture.snapshot,
      repository: alternativeFixture.repository,
      mode: 'practice-line',
      random: () => 0,
      now: () => 1_000,
    });
    const state = await alternative.submitMove(move('d2', 'd4'));
    expect(state.feedback?.kind).toBe('alternative');
    expect(state.feedback?.preferredSan).toBe('e4');
  });

  it('keeps the prompt in place through guided correction and reveals after the second legal miss', async () => {
    const fixture = await setupRepertoire({ pgn: WHITE_PGN, side: 'white' });
    const engine = await OpeningTrainingEngine.start({
      snapshot: fixture.snapshot,
      repository: fixture.repository,
      mode: 'practice-line',
      random: () => 0,
      now: () => 1_000,
    });
    const originalFen = engine.state().fen;

    expect((await engine.submitMove(move('g1', 'f3'))).phase).toBe('retry');
    const revealed = await engine.submitMove(move('c2', 'c4'));
    expect(revealed.phase).toBe('revealed');
    expect(revealed.feedback?.preferredSan).toBe('e4');
    expect(revealed.fen).toBe(originalFen);
    expect(revealed.feedback?.explanation).toBe('Claim central space.');
  });

  it('ignores illegal moves without changing correction state or persisting', async () => {
    const fixture = await setupRepertoire({ pgn: WHITE_PGN, side: 'white' });
    const record = vi.spyOn(fixture.repository, 'recordAttempt');
    const engine = await OpeningTrainingEngine.start({
      snapshot: fixture.snapshot,
      repository: fixture.repository,
      mode: 'practice-line',
      random: () => 0,
      now: () => 1_000,
    });
    const before = engine.state();
    const after = await engine.submitMove(move('e2', 'e5'));
    expect(after).toEqual(before);
    expect(record).not.toHaveBeenCalled();
  });

  it('reveals comments only after a hint is requested and escalates the second hint to SAN', async () => {
    const fixture = await setupRepertoire({ pgn: WHITE_PGN, side: 'white' });
    const engine = await OpeningTrainingEngine.start({
      snapshot: fixture.snapshot,
      repository: fixture.repository,
      mode: 'practice-line',
      random: () => 0,
      now: () => 1_000,
    });
    expect(engine.state().hintText).toBeUndefined();
    expect(engine.state().feedback).toBeUndefined();
    expect(engine.requestHint().hintText).toMatch(/Pawn move.*Claim central space/i);
    expect(engine.requestHint().hintText).toBe('Preferred move: e4');
  });

  it('persists first-response quality even after a guided correction', async () => {
    const fixture = await setupRepertoire({ pgn: WHITE_PGN, side: 'white' });
    const record = vi.spyOn(fixture.repository, 'recordAttempt');
    let now = 1_000;
    const engine = await OpeningTrainingEngine.start({
      snapshot: fixture.snapshot,
      repository: fixture.repository,
      mode: 'practice-line',
      random: () => 0,
      now: () => now,
    });
    engine.requestHint();
    now = 2_500;
    await engine.submitMove(move('g1', 'f3'));
    now = 9_000;
    await engine.submitMove(move('e2', 'e4'));

    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      attemptId: expect.any(String),
      expectedMove: 'e2e4',
      actualMove: 'g1f3',
      correct: false,
      hintCount: 1,
      hintUsed: true,
      decisionTimeMs: 1_500,
      mode: 'opening:practice-line',
    }));
  });

  it('holds resolved state on persistence failure and retries the exact same attempt id', async () => {
    const fixture = await setupRepertoire({
      pgn: '[Event "Retry"]\n[Result "*"]\n1. e4 e5 2. Nf3 *',
      side: 'white',
    });
    const record = vi.spyOn(fixture.repository, 'recordAttempt');
    record.mockRejectedValueOnce(new Error('storage unavailable'));
    const engine = await OpeningTrainingEngine.start({
      snapshot: fixture.snapshot,
      repository: fixture.repository,
      mode: 'practice-line',
      random: () => 0,
      now: () => 1_000,
    });

    const failed = await engine.submitMove(move('e2', 'e4'));
    expect(failed.phase).toBe('resolved-not-persisted');
    const firstAttemptId = record.mock.calls[0][0].attemptId;

    const retried = await engine.retryPersistence();
    expect(record).toHaveBeenCalledTimes(2);
    expect(record.mock.calls[1][0].attemptId).toBe(firstAttemptId);
    expect(retried.phase).not.toBe('resolved-not-persisted');
    expect(await fixture.db.trainingAttempts.count()).toBe(1);
  });

  it('completes a Practice Line session at a repertoire endpoint', async () => {
    const fixture = await setupRepertoire({
      pgn: '[Event "Short"]\n[Result "*"]\n1. e4 *',
      side: 'white',
    });
    const engine = await OpeningTrainingEngine.start({
      snapshot: fixture.snapshot,
      repository: fixture.repository,
      mode: 'practice-line',
      random: () => 0,
      now: () => 1_000,
    });

    const complete = await engine.submitMove(move('e2', 'e4'));
    expect(complete.complete).toBe(true);
    expect(complete.phase).toBe('complete');
    const sessions = await fixture.db.trainingSessions.toArray();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].completedAt).toBeDefined();
  });
});
