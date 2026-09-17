import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { RepertoireImportPlan } from '../openings/import/types';
import type { ParsedPgnDocument } from '../openings/pgn/types';
import type { OpeningTrainingService } from '../services/openingTrainingService';
import type { Repertoire } from '../training/types';
import { PgnImportPanel } from './PgnImportPanel';

const documentFixture: ParsedPgnDocument = {
  games: [
    { index: 0, tags: { Event: 'Italian line', White: 'A', Black: 'B' }, moves: [] },
    { index: 1, tags: { White: 'C', Black: 'D' }, moves: [] },
  ],
  warnings: [],
};

const planFixture: RepertoireImportPlan = {
  name: 'My repertoire',
  side: 'white',
  rootFen: 'root-fen',
  rootPositionKey: 'root-key',
  selectedGameIndexes: [0, 1],
  transitions: [],
  warnings: [
    {
      code: 'preferred-move-conflict',
      message: 'Selected games disagree on the preferred learner move.',
      gameIndexes: [0, 1],
    },
  ],
  counts: { games: 2, positions: 9, moves: 8 },
};

const importedRepertoire: Repertoire = {
  id: '00000000-0000-4000-8000-000000000020',
  learnerId: '00000000-0000-4000-8000-000000000001',
  name: 'My repertoire',
  side: 'white',
  archived: false,
  createdAt: '2026-09-17T00:00:00.000Z',
  updatedAt: '2026-09-17T00:00:00.000Z',
};

function fakeService(overrides: Partial<OpeningTrainingService> = {}): OpeningTrainingService {
  return {
    parsePgn: vi.fn().mockReturnValue(documentFixture),
    previewImport: vi.fn().mockReturnValue(planFixture),
    commitImport: vi.fn().mockResolvedValue(importedRepertoire),
    ...overrides,
  } as unknown as OpeningTrainingService;
}

async function choosePgnFile() {
  const file = new File(['[Event "fixture"]\n1. e4 *'], 'repertoire.pgn', {
    type: 'application/x-chess-pgn',
  });
  fireEvent.change(screen.getByLabelText(/pgn file/i), {
    target: { files: [file] },
  });
  await screen.findByRole('checkbox', { name: /italian line/i });
}

describe('PgnImportPanel', () => {
  it('parses the file, lets games be selected independently, and does not save during preview', async () => {
    const service = fakeService();
    render(
      <PgnImportPanel service={service} onImported={vi.fn()} onCancel={vi.fn()} />,
    );

    await choosePgnFile();

    expect(service.parsePgn).toHaveBeenCalledTimes(1);
    expect(service.commitImport).not.toHaveBeenCalled();
    const first = screen.getByRole('checkbox', { name: /italian line/i });
    const second = screen.getByRole('checkbox', { name: /c vs d/i });
    expect(first).toBeChecked();
    expect(second).toBeChecked();

    await userEvent.click(second);
    expect(second).not.toBeChecked();
    await userEvent.click(second);
    expect(second).toBeChecked();

    await userEvent.clear(screen.getByLabelText(/repertoire name/i));
    await userEvent.type(screen.getByLabelText(/repertoire name/i), 'My repertoire');
    await userEvent.click(screen.getByRole('button', { name: /preview import/i }));

    expect(service.previewImport).toHaveBeenCalledWith({
      document: documentFixture,
      name: 'My repertoire',
      side: 'white',
      selectedGameIndexes: [0, 1],
    });
    expect(service.commitImport).not.toHaveBeenCalled();
    expect(await screen.findByText(/2 games/i)).toBeInTheDocument();
    expect(screen.getByText(/9 positions/i)).toBeInTheDocument();
    expect(screen.getByText(/8 moves/i)).toBeInTheDocument();
    expect(screen.getByText(/disagree on the preferred learner move/i)).toBeInTheDocument();
  });

  it('blocks preview when no games are selected', async () => {
    const service = fakeService();
    render(
      <PgnImportPanel service={service} onImported={vi.fn()} onCancel={vi.fn()} />,
    );
    await choosePgnFile();

    await userEvent.click(screen.getByRole('checkbox', { name: /italian line/i }));
    await userEvent.click(screen.getByRole('checkbox', { name: /c vs d/i }));

    expect(screen.getByRole('button', { name: /preview import/i })).toBeDisabled();
    expect(service.previewImport).not.toHaveBeenCalled();
  });

  it('commits only the previewed plan and reports the imported repertoire', async () => {
    const service = fakeService();
    const onImported = vi.fn();
    render(
      <PgnImportPanel service={service} onImported={onImported} onCancel={vi.fn()} />,
    );
    await choosePgnFile();
    await userEvent.clear(screen.getByLabelText(/repertoire name/i));
    await userEvent.type(screen.getByLabelText(/repertoire name/i), 'My repertoire');
    await userEvent.click(screen.getByRole('radio', { name: /black/i }));
    await userEvent.click(screen.getByRole('button', { name: /preview import/i }));

    expect(service.commitImport).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole('button', { name: /create repertoire/i }));

    expect(service.commitImport).toHaveBeenCalledTimes(1);
    expect(service.commitImport).toHaveBeenCalledWith(planFixture);
    await waitFor(() => expect(onImported).toHaveBeenCalledWith(importedRepertoire));
  });

  it('renders parse and validation errors as alerts without committing', async () => {
    const service = fakeService({
      parsePgn: vi.fn(() => {
        throw new Error('PGN could not be parsed');
      }),
    });
    render(
      <PgnImportPanel service={service} onImported={vi.fn()} onCancel={vi.fn()} />,
    );

    const file = new File(['bad pgn'], 'bad.pgn', { type: 'application/x-chess-pgn' });
    fireEvent.change(screen.getByLabelText(/pgn file/i), {
      target: { files: [file] },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be parsed/i);
    expect(service.commitImport).not.toHaveBeenCalled();
  });
});
