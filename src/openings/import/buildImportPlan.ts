import { ChessGame } from '../../core/game';
import { positionKeyFromFen } from '../../core/positionIdentity';
import { deriveTransition } from '../../training/graph';
import type { ParsedPgnDocument, ParsedPgnLine, ParsedPgnMove } from '../pgn/types';
import { resolveParsedMove } from './resolveNotation';
import type {
  ImportSide,
  ImportWarning,
  PlannedRepertoireTransition,
  RepertoireImportPlan,
} from './types';

type BuildOptions = {
  name: string;
  side: ImportSide;
  selectedGameIndexes: number[];
};

type CollectedTransition = PlannedRepertoireTransition & {
  fromPositionKey: string;
  toPositionKey: string;
  moveKey: string;
};

type PreferredCandidate = { gameIndex: number; moveKey: string };

function rootFenFor(tags: Record<string, string>): string {
  if (tags.SetUp === '1') {
    if (!tags.FEN) throw new Error('PGN SetUp game is missing its FEN tag.');
    return new ChessGame(tags.FEN).snapshot().fen;
  }
  return new ChessGame().snapshot().fen;
}

function learnerTurn(side: ImportSide): 'w' | 'b' {
  return side === 'white' ? 'w' : 'b';
}

function occurrenceKey(fromPositionKey: string, moveKey: string): string {
  return `${fromPositionKey}|${moveKey}`;
}

export function buildRepertoireImportPlan(
  document: ParsedPgnDocument,
  options: BuildOptions,
): RepertoireImportPlan {
  const name = options.name.trim();
  if (!name) throw new Error('Repertoire name is required.');

  const selectedGameIndexes = [...new Set(options.selectedGameIndexes)].sort((a, b) => a - b);
  if (selectedGameIndexes.length === 0) throw new Error('Select at least one PGN game.');

  const selectedGames = selectedGameIndexes.map((index) => {
    const game = document.games[index];
    if (!game) throw new Error(`Selected PGN game ${index} does not exist.`);
    return game;
  });

  const rootFens = selectedGames.map((game) => rootFenFor(game.tags));
  const rootKeys = rootFens.map(positionKeyFromFen);
  const rootPositionKey = rootKeys[0];
  if (rootKeys.some((key) => key !== rootPositionKey)) {
    throw new Error('Selected PGN games must share the same root position.');
  }
  const rootFen = rootFens[0];
  const selectedLearnerTurn = learnerTurn(options.side);

  const transitionMap = new Map<string, CollectedTransition>();
  const positionKeys = new Set<string>([rootPositionKey]);
  const preferredByGamePosition = new Map<string, PreferredCandidate>();
  let order = 0;

  const collectMove = (
    parsed: ParsedPgnMove,
    fromFen: string,
    gameIndex: number,
  ) => {
    const game = new ChessGame(fromFen);
    const move = resolveParsedMove(game, parsed);
    const derived = deriveTransition(fromFen, move);
    const isLearner = parsed.turn === selectedLearnerTurn;
    const key = occurrenceKey(derived.fromPositionKey, derived.moveKey);

    positionKeys.add(derived.fromPositionKey);
    positionKeys.add(derived.toPositionKey);

    const existing = transitionMap.get(key);
    if (!existing) {
      transitionMap.set(key, {
        fromFen: derived.fromFen,
        fromPositionKey: derived.fromPositionKey,
        toPositionKey: derived.toPositionKey,
        moveKey: derived.moveKey,
        move,
        role: isLearner ? 'alternative' : 'opponent',
        preferred: false,
        trainable: isLearner,
        order: order++,
        ...(parsed.comment ? { explanation: parsed.comment } : {}),
      });
    } else if (!existing.explanation && parsed.comment) {
      existing.explanation = parsed.comment;
    }

    if (isLearner) {
      const candidateKey = `${gameIndex}|${derived.fromPositionKey}`;
      if (!preferredByGamePosition.has(candidateKey)) {
        preferredByGamePosition.set(candidateKey, { gameIndex, moveKey: derived.moveKey });
      }
    }

    return derived;
  };

  const walkLine = (
    line: ParsedPgnLine,
    startFen: string,
    gameIndex: number,
  ): void => {
    let currentFen = startFen;
    for (const parsed of line) {
      const beforeFen = currentFen;
      const derived = collectMove(parsed, beforeFen, gameIndex);
      for (const variation of parsed.variations) {
        walkLine(variation, beforeFen, gameIndex);
      }
      currentFen = derived.toFen;
    }
  };

  selectedGames.forEach((game, selectedOffset) => {
    walkLine(game.moves, rootFens[selectedOffset], game.index);
  });

  const warnings: ImportWarning[] = document.warnings.map((warning) => ({
    code: 'parser-warning',
    message: warning.message,
    gameIndexes: selectedGameIndexes,
  }));

  const candidatePositions = new Map<string, PreferredCandidate[]>();
  for (const [key, candidate] of preferredByGamePosition) {
    const separator = key.indexOf('|');
    const positionKey = key.slice(separator + 1);
    const list = candidatePositions.get(positionKey) ?? [];
    list.push(candidate);
    candidatePositions.set(positionKey, list);
  }

  for (const [positionKey, candidates] of candidatePositions) {
    candidates.sort((a, b) => a.gameIndex - b.gameIndex);
    const preferred = candidates[0];
    const preferredTransition = transitionMap.get(occurrenceKey(positionKey, preferred.moveKey));
    if (preferredTransition) {
      preferredTransition.preferred = true;
      preferredTransition.role = 'learner';
    }

    for (const candidate of candidates.slice(1)) {
      if (candidate.moveKey === preferred.moveKey) continue;
      warnings.push({
        code: 'preferred-move-conflict',
        message: `Selected games disagree on the preferred learner move from a shared position; game ${preferred.gameIndex + 1} takes precedence over game ${candidate.gameIndex + 1}.`,
        gameIndexes: [preferred.gameIndex, candidate.gameIndex],
      });
    }
  }

  const transitions = [...transitionMap.values()]
    .sort((a, b) => a.order - b.order)
    .map<PlannedRepertoireTransition>(({ fromPositionKey: _from, toPositionKey: _to, moveKey: _key, ...item }) => item);

  return {
    name,
    side: options.side,
    rootFen,
    rootPositionKey,
    selectedGameIndexes,
    transitions,
    warnings,
    counts: {
      games: selectedGameIndexes.length,
      positions: positionKeys.size,
      moves: transitions.length,
    },
  };
}
