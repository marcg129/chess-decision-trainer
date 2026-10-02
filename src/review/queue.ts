import type {
  ReviewInventory,
  ReviewInventoryTarget,
} from '../training/repositories';
import type { EntityId } from '../training/types';
import type { ReviewSettings } from './types';

export type ReviewCard = {
  target: ReviewInventoryTarget;
  newCard: boolean;
};

export type ReviewSessionPlan = {
  cards: ReviewCard[];
  remainingAfterBatch: number;
  newAvailable: number;
  settings: ReviewSettings;
};

export type BuildReviewQueueInput = {
  inventory: ReviewInventory;
  settings: ReviewSettings;
  newIntroductionsToday: number;
  filterRepertoireId?: EntityId;
};

function targetId(target: ReviewInventoryTarget): string {
  return target.preferred.repertoireMove.id;
}

function filterTargets(
  targets: ReviewInventoryTarget[],
  repertoireId?: EntityId,
): ReviewInventoryTarget[] {
  if (!repertoireId) return [...targets];
  return targets.filter((target) => target.repertoire.id === repertoireId);
}

function sortDue(targets: ReviewInventoryTarget[]): ReviewInventoryTarget[] {
  return [...targets].sort((a, b) => {
    const aDue = a.mastery?.nextReviewAt ?? '';
    const bDue = b.mastery?.nextReviewAt ?? '';
    return aDue.localeCompare(bDue)
      || a.repertoire.id.localeCompare(b.repertoire.id)
      || targetId(a).localeCompare(targetId(b));
  });
}

function sortNewWithinRepertoire(
  targets: ReviewInventoryTarget[],
): ReviewInventoryTarget[] {
  return [...targets].sort((a, b) =>
    a.depth - b.depth
    || a.sourceOrder - b.sourceOrder
    || targetId(a).localeCompare(targetId(b)));
}

function roundRobinNew(
  targets: ReviewInventoryTarget[],
  limit: number,
): ReviewInventoryTarget[] {
  if (limit <= 0 || targets.length === 0) return [];

  const groups = new Map<EntityId, ReviewInventoryTarget[]>();
  for (const target of targets) {
    const group = groups.get(target.repertoire.id) ?? [];
    group.push(target);
    groups.set(target.repertoire.id, group);
  }

  const repertoireIds = [...groups.keys()].sort((a, b) => a.localeCompare(b));
  for (const repertoireId of repertoireIds) {
    groups.set(
      repertoireId,
      sortNewWithinRepertoire(groups.get(repertoireId) ?? []),
    );
  }

  const selected: ReviewInventoryTarget[] = [];
  let depth = 0;
  while (selected.length < limit) {
    let added = false;
    for (const repertoireId of repertoireIds) {
      const candidate = groups.get(repertoireId)?.[depth];
      if (!candidate) continue;
      selected.push(candidate);
      added = true;
      if (selected.length >= limit) break;
    }
    if (!added) break;
    depth += 1;
  }
  return selected;
}

export function buildReviewQueue(
  input: BuildReviewQueueInput,
): ReviewSessionPlan {
  const batchSize = Math.max(0, input.settings.batchSize);
  const due = sortDue(
    filterTargets(input.inventory.due, input.filterRepertoireId),
  );
  const newCandidates = filterTargets(
    input.inventory.newCandidates,
    input.filterRepertoireId,
  );

  const remainingDailyAllowance = Math.max(
    0,
    input.settings.newItemsPerDay - Math.max(0, input.newIntroductionsToday),
  );
  const newAvailable = Math.min(
    newCandidates.length,
    remainingDailyAllowance,
  );

  const dueSelected = due.slice(0, batchSize);
  const remainingBatchSlots = Math.max(0, batchSize - dueSelected.length);
  const newSelected = roundRobinNew(
    newCandidates,
    Math.min(remainingBatchSlots, newAvailable),
  );

  const cards: ReviewCard[] = [
    ...dueSelected.map((target) => ({ target, newCard: false })),
    ...newSelected.map((target) => ({ target, newCard: true })),
  ];

  return {
    cards,
    remainingAfterBatch:
      Math.max(0, due.length - dueSelected.length)
      + Math.max(0, newAvailable - newSelected.length),
    newAvailable,
    settings: { ...input.settings },
  };
}
