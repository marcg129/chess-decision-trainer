import {
  parse,
  type Notation,
  type NotationList,
  type ParseError,
  type ParseWarning,
} from '@echecs/pgn';
import type {
  ParsedPgnDocument,
  ParsedPgnGame,
  ParsedPgnLine,
  ParsedPgnMove,
  PgnIssue,
} from './types';

type PgnPiece = Notation['piece'];
type PgnPromotion = NonNullable<Notation['promotion']>;

const PIECE_CODES: Record<PgnPiece, ParsedPgnMove['piece']> = {
  pawn: 'p',
  knight: 'n',
  bishop: 'b',
  rook: 'r',
  queen: 'q',
  king: 'k',
};

const PROMOTION_CODES: Record<PgnPromotion, NonNullable<ParsedPgnMove['promotion']>> = {
  knight: 'n',
  bishop: 'b',
  rook: 'r',
  queen: 'q',
};

function issueFromWarning(warning: ParseWarning): PgnIssue {
  return {
    severity: 'warning',
    message: warning.message,
    line: warning.line,
    column: warning.column,
  };
}

function normalizeMove(
  notation: Notation,
  turn: 'w' | 'b',
  moveNumber: number,
): ParsedPgnMove {
  const comment = notation.comment?.trim();
  return {
    turn,
    moveNumber,
    piece: PIECE_CODES[notation.piece],
    to: notation.to,
    fromHint: notation.from,
    capture: notation.capture,
    castle: notation.castling ? (notation.long ? 'queenside' : 'kingside') : null,
    promotion: notation.promotion ? PROMOTION_CODES[notation.promotion] : undefined,
    comment: comment || undefined,
    annotations: [...(notation.annotations ?? [])],
    variations: (notation.variants ?? []).map(normalizeLine),
  };
}

function normalizeLine(list: NotationList): ParsedPgnLine {
  const moves: ParsedPgnMove[] = [];
  for (const [moveNumber, white, black] of list) {
    if (white) moves.push(normalizeMove(white, 'w', moveNumber));
    if (black) moves.push(normalizeMove(black, 'b', moveNumber));
  }
  return moves;
}

function normalizeTags(meta: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(meta).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

function formatParseError(error: ParseError): Error {
  return new Error(`PGN parse failed at line ${error.line}:${error.column}: ${error.message}`);
}

export function parsePgnSource(input: string): ParsedPgnDocument {
  const warnings: PgnIssue[] = [];
  let parseError: ParseError | null = null;

  const games = parse(input, {
    onError(error) {
      parseError ??= error;
    },
    onWarning(warning) {
      warnings.push(issueFromWarning(warning));
    },
  });

  if (parseError) throw formatParseError(parseError);
  if (input.trim().length > 0 && games.length === 0) {
    throw new Error('PGN input did not contain a parseable game.');
  }

  return {
    games: games.map<ParsedPgnGame>((game, index) => ({
      index,
      tags: normalizeTags(game.meta),
      moves: normalizeLine(game.moves),
    })),
    warnings,
  };
}
