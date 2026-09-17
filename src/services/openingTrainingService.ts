import { DEMO_PGN, DEMO_REPERTOIRE_ID } from '../openings/demoPgn';
import { buildRepertoireImportPlan } from '../openings/import/buildImportPlan';
import type { ImportSide, RepertoireImportPlan } from '../openings/import/types';
import { parsePgnSource } from '../openings/pgn/parsePgn';
import type { ParsedPgnDocument } from '../openings/pgn/types';
import type {
  RepertoireTrainingSnapshot,
  TrainingRepository,
} from '../training/repositories';
import { createId, type EntityId, type Repertoire } from '../training/types';

export class OpeningTrainingService {
  constructor(private readonly training: TrainingRepository) {}

  parsePgn(input: string): ParsedPgnDocument {
    return parsePgnSource(input);
  }

  previewImport(input: {
    document: ParsedPgnDocument;
    name: string;
    side: ImportSide;
    selectedGameIndexes: number[];
  }): RepertoireImportPlan {
    return buildRepertoireImportPlan(input.document, {
      name: input.name,
      side: input.side,
      selectedGameIndexes: input.selectedGameIndexes,
    });
  }

  async commitImport(plan: RepertoireImportPlan): Promise<Repertoire> {
    const learner = await this.training.ensureLocalLearner('Local learner');
    const now = new Date().toISOString();
    const repertoire: Repertoire = {
      id: createId(),
      learnerId: learner.id,
      name: plan.name,
      side: plan.side,
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
    await this.training.createRepertoireFromTransitions({
      repertoire,
      transitions: plan.transitions.map((transition) => ({
        ...transition,
        repertoireId: repertoire.id,
      })),
    });
    return repertoire;
  }

  async ensureDemoRepertoire(): Promise<Repertoire> {
    const existing = await this.training.getRepertoire(DEMO_REPERTOIRE_ID);
    if (existing) return existing;

    const learner = await this.training.ensureLocalLearner('Local learner');
    const plan = this.previewImport({
      document: this.parsePgn(DEMO_PGN),
      name: 'Italian Game Demo',
      side: 'white',
      selectedGameIndexes: [0],
    });
    const now = new Date().toISOString();
    const repertoire: Repertoire = {
      id: DEMO_REPERTOIRE_ID,
      learnerId: learner.id,
      name: plan.name,
      side: plan.side,
      description: 'Built-in opening training demo.',
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
    await this.training.createRepertoireFromTransitions({
      repertoire,
      transitions: plan.transitions.map((transition) => ({
        ...transition,
        repertoireId: repertoire.id,
      })),
    });
    return repertoire;
  }

  async listRepertoires(): Promise<Repertoire[]> {
    const learner = await this.training.ensureLocalLearner('Local learner');
    const repertoires = await this.training.listRepertoires(learner.id);
    return repertoires.sort((a, b) => a.name.localeCompare(b.name));
  }

  loadRepertoire(repertoireId: EntityId): Promise<RepertoireTrainingSnapshot> {
    return this.training.loadRepertoireTrainingSnapshot(repertoireId);
  }
}
