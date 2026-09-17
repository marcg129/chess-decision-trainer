import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DEMO_REPERTOIRE_ID } from '../openings/demoPgn';
import type { OpeningTrainingService } from '../services/openingTrainingService';
import type { Repertoire } from '../training/types';
import { OpeningTrainingHome } from './OpeningTrainingHome';

const NOW = '2026-09-17T00:00:00.000Z';

function repertoire(
  id: string,
  name: string,
  archived = false,
): Repertoire {
  return {
    id,
    learnerId: '00000000-0000-4000-8000-000000000001',
    name,
    side: 'white',
    archived,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function fakeService(overrides: Partial<OpeningTrainingService> = {}): OpeningTrainingService {
  return {
    listRepertoires: vi.fn().mockResolvedValue([
      repertoire('00000000-0000-4000-8000-000000000010', 'Italian repertoire'),
      repertoire('00000000-0000-4000-8000-000000000011', 'Archived repertoire', true),
    ]),
    ensureDemoRepertoire: vi.fn().mockResolvedValue(
      repertoire(DEMO_REPERTOIRE_ID, 'Italian Game Demo'),
    ),
    ...overrides,
  } as unknown as OpeningTrainingService;
}

describe('OpeningTrainingHome', () => {
  it('lists active repertoires and launches Practice Line or Quick Recall for the selected repertoire', async () => {
    const service = fakeService();
    const onLaunch = vi.fn();
    render(
      <OpeningTrainingHome
        service={service}
        onLaunch={onLaunch}
        onImport={vi.fn()}
      />,
    );

    expect(await screen.findByText('Italian repertoire')).toBeInTheDocument();
    expect(screen.queryByText('Archived repertoire')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /practice line/i }));
    expect(onLaunch).toHaveBeenCalledWith({
      repertoireId: '00000000-0000-4000-8000-000000000010',
      mode: 'practice-line',
    });

    await userEvent.click(screen.getByRole('button', { name: /quick recall/i }));
    expect(onLaunch).toHaveBeenLastCalledWith({
      repertoireId: '00000000-0000-4000-8000-000000000010',
      mode: 'quick-recall',
    });
  });

  it('installs the demo before launching Practice Line', async () => {
    const service = fakeService();
    const onLaunch = vi.fn();
    render(
      <OpeningTrainingHome
        service={service}
        onLaunch={onLaunch}
        onImport={vi.fn()}
      />,
    );
    await screen.findByText('Italian repertoire');

    await userEvent.click(screen.getByRole('button', { name: /try demo/i }));

    expect(service.ensureDemoRepertoire).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(onLaunch).toHaveBeenCalledWith({
        repertoireId: DEMO_REPERTOIRE_ID,
        mode: 'practice-line',
      }),
    );
  });

  it('opens the PGN import workflow on request', async () => {
    const onImport = vi.fn();
    render(
      <OpeningTrainingHome
        service={fakeService()}
        onLaunch={vi.fn()}
        onImport={onImport}
      />,
    );
    await screen.findByText('Italian repertoire');

    await userEvent.click(screen.getByRole('button', { name: /import pgn/i }));
    expect(onImport).toHaveBeenCalledTimes(1);
  });
});
