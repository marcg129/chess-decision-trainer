export type ParsedPgnMove = {
  turn: 'w' | 'b';
  moveNumber: number;
  piece: 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
  to?: string;
  fromHint?: string;
  capture: boolean;
  castle: 'kingside' | 'queenside' | null;
  promotion?: 'q' | 'r' | 'b' | 'n';
  comment?: string;
  annotations: string[];
  variations: ParsedPgnLine[];
};

export type ParsedPgnLine = ParsedPgnMove[];

export type ParsedPgnGame = {
  index: number;
  tags: Record<string, string>;
  moves: ParsedPgnLine;
};

export type PgnIssue = {
  severity: 'warning' | 'error';
  message: string;
  line: number;
  column: number;
};

export type ParsedPgnDocument = {
  games: ParsedPgnGame[];
  warnings: PgnIssue[];
};
