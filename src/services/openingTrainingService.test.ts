import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { ChessTrainingDatabase } from '../persistence/db';
import { DexieTrainingRepository } from '../persistence/dexieTrainingRepository';
import { DEMO_REPERTOIRE_ID } from '../openings/demoPgn';
import { OpeningTrainingService } from './openingTrainingService';

const databases: ChessTrainingDatabase[] = [];

function setup() {
  const db = new ChessTrainingDatabase(`opening-service-${crypto.randomUUID()}`);
  databases.push(db);
  const repository = new DexieTrainingRepository(db);
  const service = new OpeningTrainingService(repository);
  return { db, service };
}

afterEach(async () => {
  while (databases.length) {
    const db = databases.pop();
    if (db) await db.delete();
  }
});

describe('OpeningTrainingService', () => {
  it('commits a preview as one new repertoire through the bulk repository path', async () => {
    const { db, service } = setup();
    const document = service.parsePgn(`
[Event "User repertoire"]
[Result "*"]
1. e4 {Claim the center.} e5 (1... c5 2. Nf3) 2. Nf3 *
`);
    const plan = service.previewImport({
      document,
      name: 'My White Repertoire',
      side: 'white',
      selectedGameIndexes: [0],
    });

    const repertoire = await service.commitImport(plan);

    expect(repertoire.name).toBe('My White Repertoire');
    expect(repertoire.side).toBe('white');
    expect(await db.repertoires.count()).toBe(1);
    const snapshot = await service.loadRepertoire(repertoire.id);
    expect(snapshot.repertoireMoves.length).toBeGreaterThan(2);
    expect(snapshot.repertoireMoves.some((move) => move.explanation === 'Claim the center.')).toBe(true);
  });

  it('installs the built-in demo idempotently through the same import path', async () => {
    const { db, service } = setup();

    const first = await service.ensureDemoRepertoire();
    const second = await service.ensureDemoRepertoire();

    expect(first.id).toBe(DEMO_REPERTOIRE_ID);
    expect(second.id).toBe(DEMO_REPERTOIRE_ID);
    expect(await db.repertoires.count()).toBe(1);
    const snapshot = await service.loadRepertoire(DEMO_REPERTOIRE_ID);
    expect(snapshot.repertoireMoves.some((move) => move.role === 'opponent')).toBe(true);
    expect(snapshot.repertoireMoves.some((move) => move.explanation)).toBe(true);
  });

  it('lists repertoires for the single local learner', async () => {
    const { service } = setup();
    await service.ensureDemoRepertoire();
    const repertoires = await service.listRepertoires();
    expect(repertoires.map((item) => item.id)).toContain(DEMO_REPERTOIRE_ID);
  });

  it('starts a training session through the engine factory', async () => {
    const { service } = setup();
    const repertoire = await service.ensureDemoRepertoire();
    const engine = await service.startSession({
      repertoireId: repertoire.id,
      mode: 'practice-line',
      random: () => 0,
      now: () => 1_000,
    });

    expect(engine.state().repertoireId).toBe(repertoire.id);
    expect(engine.state().mode).toBe('practice-line');
    expect(engine.state().phase).toBe('awaiting-move');
  });
});
