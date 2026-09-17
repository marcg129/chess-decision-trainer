import { Chess } from 'chess.js';
import { positionKeyFromFen } from '../core/positionIdentity';
import { InvalidChessEdgeError } from './errors';
import type { TrainingMoveInput } from './types';

export type DerivedTransition = {
  fromFen: string;
  fromPositionKey: string;
  toFen: string;
  toPositionKey: string;
  moveKey: string;
  from: TrainingMoveInput['from'];
  to: TrainingMoveInput['to'];
  promotion?: NonNullable<TrainingMoveInput['promotion']>;
  san: string;
};

export function deriveTransition(
  fromFen: string,
  moveInput: TrainingMoveInput,
): DerivedTransition {
  try {
    const chess = new Chess(fromFen);
    const fromPositionKey = positionKeyFromFen(fromFen);
    const move = chess.move(moveInput);
    const toFen = chess.fen();
    const promotion = move.promotion;

    if (
      promotion !== undefined &&
      promotion !== 'q' &&
      promotion !== 'r' &&
      promotion !== 'b' &&
      promotion !== 'n'
    ) {
      throw new InvalidChessEdgeError('Chess engine returned an invalid promotion piece.');
    }

    return {
      fromFen,
      fromPositionKey,
      toFen,
      toPositionKey: positionKeyFromFen(toFen),
      moveKey: `${move.from}${move.to}${promotion ?? ''}`,
      from: move.from,
      to: move.to,
      promotion,
      san: move.san,
    };
  } catch (error) {
    if (error instanceof InvalidChessEdgeError) throw error;
    throw new InvalidChessEdgeError(
      error instanceof Error ? error.message : 'Invalid chess transition',
    );
  }
}
