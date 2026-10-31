import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DEMO_REPERTOIRE_ID } from '../openings/demoPgn';
import type { OpeningTrainingService } from '../services/openingTrainingService';
import type { ReviewTrainingService } from '../services/reviewTrainingService';
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


function fakeReviewService(
  overrides: Partial<ReviewTrainingService> = {},
): ReviewTrainingService {
  return {
    getOverview: vi.fn().mockResolvedValue({
      dueCount: 4,
      newAvailable: 3,
      settings: { newItemsPerDay: 10, batchSize: 15 },
    }),
    updateSettings: vi.fn().mockImplementation(async (settings) => settings),
    ...overrides,
  } as unknown as ReviewTrainingService;
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

  it('shows Review Due inventory and starts a global review session by default', async () => {
    const reviewService = fakeReviewService();
    const onReview = vi.fn();

    render(
      <OpeningTrainingHome
        service={fakeService()}
        reviewService={reviewService}
        onLaunch={vi.fn()}
        onReview={onReview}
        onImport={vi.fn()}
      />,
    );

    expect(await screen.findByText(/4 due · 3 new available/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^review due$/i }));

    expect(onReview).toHaveBeenCalledWith({});
  });

  it('can filter Review Due to one repertoire without changing opening-practice selection', async () => {
    const reviewService = fakeReviewService({
      getOverview: vi.fn().mockResolvedValue({
        dueCount: 2,
        newAvailable: 1,
        settings: { newItemsPerDay: 10, batchSize: 15 },
      }),
    });
    const onReview = vi.fn();

    render(
      <OpeningTrainingHome
        service={fakeService()}
        reviewService={reviewService}
        onLaunch={vi.fn()}
        onReview={onReview}
        onImport={vi.fn()}
      />,
    );

    await screen.findByText('Italian repertoire');
    await userEvent.selectOptions(
      screen.getByLabelText(/review repertoire filter/i),
      '00000000-0000-4000-8000-000000000010',
    );
    await waitFor(() =>
      expect(reviewService.getOverview).toHaveBeenLastCalledWith({
        repertoireId: '00000000-0000-4000-8000-000000000010',
      }),
    );

    await userEvent.click(screen.getByRole('button', { name: /^review due$/i }));
    expect(onReview).toHaveBeenCalledWith({
      repertoireId: '00000000-0000-4000-8000-000000000010',
    });

    await userEvent.click(screen.getByRole('button', { name: /practice line/i }));
    expect(onReview).toHaveBeenCalledTimes(1);
  });

  it('initializes and persists valid Review Due settings while refusing invalid values', async () => {
    const updateSettings = vi.fn().mockResolvedValue({
      newItemsPerDay: 12,
      batchSize: 20,
    });
    const reviewService = fakeReviewService({ updateSettings });

    render(
      <OpeningTrainingHome
        service={fakeService()}
        reviewService={reviewService}
        onLaunch={vi.fn()}
        onReview={vi.fn()}
        onImport={vi.fn()}
      />,
    );

    const newItems = await screen.findByLabelText(/new items per day/i);
    const batchSize = screen.getByLabelText(/review batch size/i);
    expect(newItems).toHaveValue(10);
    expect(batchSize).toHaveValue(15);

    await userEvent.clear(newItems);
    await userEvent.type(newItems, '12');
    await userEvent.clear(batchSize);
    await userEvent.type(batchSize, '20');
    await userEvent.click(screen.getByRole('button', { name: /save review settings/i }));

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        newItemsPerDay: 12,
        batchSize: 20,
      }),
    );

    await userEvent.clear(newItems);
    await userEvent.type(newItems, '101');
    expect(screen.getByRole('button', { name: /save review settings/i })).toBeDisabled();
    expect(updateSettings).toHaveBeenCalledTimes(1);
  });

});
