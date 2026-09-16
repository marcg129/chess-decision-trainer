import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

vi.mock('react-chessboard', () => ({
  Chessboard: ({ options }: { options: any }) => (
    <div
      data-testid="board"
      data-orientation={options.boardOrientation}
      data-position={options.position}
    >
      <button onClick={() => options.onSquareClick?.({ square: 'e2', piece: { pieceType: 'wP' } })}>
        click e2
      </button>
      <button onClick={() => options.onSquareClick?.({ square: 'e4', piece: null })}>
        click e4
      </button>
      <button onClick={() => options.onSquareClick?.({ square: 'a7', piece: { pieceType: 'wP' } })}>
        click a7
      </button>
      <button onClick={() => options.onSquareClick?.({ square: 'a8', piece: null })}>
        click a8
      </button>
      <button
        onClick={() =>
          options.onPieceDrop?.({
            sourceSquare: 'e2',
            targetSquare: 'e4',
            piece: { pieceType: 'wP' },
          })
        }
      >
        drag e2-e4
      </button>
    </div>
  ),
}));

test('blocks moves until the 3+2 clock is explicitly started', async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.click(screen.getByRole('button', { name: 'click e2' }));
  await user.click(screen.getByRole('button', { name: 'click e4' }));
  expect(screen.queryByText(/^e4$/)).not.toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: /start game/i }));
  await user.click(screen.getByRole('button', { name: 'click e2' }));
  await user.click(screen.getByRole('button', { name: 'click e4' }));
  expect(screen.getByText(/^e4$/)).toBeInTheDocument();
});

test('accepts a legal drag move after Start', async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: /start game/i }));
  await user.click(screen.getByRole('button', { name: 'drag e2-e4' }));
  expect(screen.getByText(/^e4$/)).toBeInTheDocument();
});

test('flips orientation without changing the position', async () => {
  const user = userEvent.setup();
  render(<App />);
  const board = screen.getByTestId('board');
  const initialPosition = board.getAttribute('data-position');
  expect(board).toHaveAttribute('data-orientation', 'white');

  await user.click(screen.getByRole('button', { name: /flip board/i }));
  expect(board).toHaveAttribute('data-orientation', 'black');
  expect(board).toHaveAttribute('data-position', initialPosition);
});

test('requires an explicit promotion choice and supports underpromotion', async () => {
  const user = userEvent.setup();
  render(<App initialFen="7k/P7/8/8/8/8/8/K7 w - - 0 1" />);
  await user.click(screen.getByRole('button', { name: /start game/i }));
  await user.click(screen.getByRole('button', { name: 'click a7' }));
  await user.click(screen.getByRole('button', { name: 'click a8' }));

  expect(
    screen.getByRole('dialog', { name: /choose promotion piece/i }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Knight' }));
  expect(screen.getByText(/^a8=N$/)).toBeInTheDocument();
});

test('represents an already-completed game and does not offer Start', () => {
  render(<App initialFen="7k/6Q1/6K1/8/8/8/8/8 b - - 0 1" />);
  expect(screen.getByText(/checkmate/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /start|resume/i })).not.toBeInTheDocument();
});

test('rolls back a move attempted after the monotonic clock has expired', () => {
  let nowMs = 0;
  const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
  render(<App />);

  fireEvent.click(screen.getByRole('button', { name: /start game/i }));
  nowMs = 180_001;
  fireEvent.click(screen.getByRole('button', { name: 'drag e2-e4' }));

  expect(screen.queryByText(/^e4$/)).not.toBeInTheDocument();
  expect(screen.getByText(/white.*time/i)).toBeInTheDocument();
  nowSpy.mockRestore();
});

test('exposes live FEN, training position key, PGN, and copy actions', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  const user = userEvent.setup();
  render(<App />);

  const fen = screen.getByLabelText('FEN') as HTMLTextAreaElement;
  const positionKey = screen.getByLabelText('Position key') as HTMLTextAreaElement;
  const pgn = screen.getByLabelText('PGN') as HTMLTextAreaElement;

  expect(fen.value).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  expect(positionKey.value).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -');
  expect(pgn.value).toBe('No moves yet.');
  expect(screen.getByRole('button', { name: /copy pgn/i })).toBeDisabled();

  await user.click(screen.getByRole('button', { name: /start game/i }));
  await user.click(screen.getByRole('button', { name: 'drag e2-e4' }));
  expect(pgn.value).toContain('1. e4');

  await user.click(screen.getByRole('button', { name: /copy fen/i }));
  expect(writeText).toHaveBeenLastCalledWith(fen.value);
  await user.click(screen.getByRole('button', { name: /copy pgn/i }));
  expect(writeText).toHaveBeenLastCalledWith(pgn.value);
});

test('reports a clipboard failure without breaking the game', async () => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
  });
  const user = userEvent.setup();
  render(<App />);

  await user.click(screen.getByRole('button', { name: /copy fen/i }));
  expect(await screen.findByText('Clipboard unavailable')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /chess decision trainer/i })).toBeInTheDocument();
});
