export class InvalidChessEdgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidChessEdgeError';
  }
}
