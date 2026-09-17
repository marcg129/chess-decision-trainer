import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const START_KEY = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKQkq -';
const NOW = '2026-09-17T14:00:00.000Z';

const backup = {
  format: 'chess-decision-trainer',
  version: 1,
  exportedAt: NOW,
  schemaVersion: 2,
  data: {
    learnerProfiles: [
      {
        id: '10000000-0000-4000-8000-000000000001',
        displayName: 'Persistence Smoke Learner',
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    repertoires: [
      {
        id: '10000000-0000-4000-8000-000000000002',
        learnerId: '10000000-0000-4000-8000-000000000001',
        name: 'Persistence Smoke Repertoire',
        side: 'white',
        archived: false,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    positions: [
      {
        id: '10000000-0000-4000-8000-000000000003',
        positionKey: START_KEY,
        fen: START_FEN,
        sideToMove: 'w',
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    moveEdges: [],
    repertoirePositions: [
      {
        id: '10000000-0000-4000-8000-000000000004',
        repertoireId: '10000000-0000-4000-8000-000000000002',
        positionId: '10000000-0000-4000-8000-000000000003',
        trainable: true,
        tags: [],
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    repertoireMoves: [],
    positionMastery: [],
    repertoireMoveMastery: [],
    trainingSessions: [],
    trainingAttempts: [],
  },
} as const;

async function openData(page: import('@playwright/test').Page) {
  await page.getByRole('tab', { name: 'Data' }).click();
  await expect(page.getByRole('heading', { name: 'Training data' })).toBeVisible();
}

test('restored training data survives reload and exports through the public UI', async ({ page }) => {
  await page.goto('/');
  await openData(page);

  await page.getByLabel('Restore backup file').setInputFiles({
    name: 'persistence-smoke.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });

  await expect(page.getByText(/Valid backup: 1 repertoires · 1 positions · 0 attempts/i)).toBeVisible();
  await page.getByRole('button', { name: 'Replace local data' }).click();

  await expect(page.getByText('Persistence Smoke Repertoire')).toBeVisible();
  await expect(page.getByText(/1 repertoires · 1 positions · 0 moves/i)).toBeVisible();

  await page.reload();
  await openData(page);
  await expect(page.getByText('Persistence Smoke Repertoire')).toBeVisible();
  await expect(page.getByText(/1 repertoires · 1 positions · 0 moves/i)).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();

  const exported = JSON.parse(await readFile(path!, 'utf8')) as typeof backup;
  expect(exported.format).toBe('chess-decision-trainer');
  expect(exported.version).toBe(1);
  expect(exported.data.repertoires.some((item) => item.name === 'Persistence Smoke Repertoire')).toBe(true);
});

test('training data utilities fit a 320px viewport without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/');
  await openData(page);

  const heading = page.getByRole('heading', { name: 'Training data' });
  await heading.scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Export backup' })).toBeVisible();
  await expect(page.getByLabel('Restore backup file')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reset local data' })).toBeVisible();

  const overflow = await page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
