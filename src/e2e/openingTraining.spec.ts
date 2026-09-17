import { expect, test, type Page } from '@playwright/test';

const IMPORT_PGN = `[Event "E2E A"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 *

[Event "E2E B"]
[Result "*"]

1. e4 c5 2. Nf3 d6 *`;

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
    - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function importWhiteRepertoire(page: Page) {
  await page.getByRole('button', { name: 'Import PGN' }).click();
  await expect(page.getByRole('heading', { name: 'Import PGN' })).toBeVisible();

  await page.getByLabel('PGN file').setInputFiles({
    name: 'opening.pgn',
    mimeType: 'application/x-chess-pgn',
    buffer: Buffer.from(IMPORT_PGN),
  });

  await expect(page.getByRole('checkbox', { name: 'E2E A' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'E2E B' })).toBeChecked();
  await page.getByLabel('Repertoire name').fill('E2E White');
  await expect(page.getByRole('radio', { name: 'White' })).toBeChecked();

  await page.getByRole('button', { name: 'Preview import' }).click();
  await expect(page.getByRole('heading', { name: 'Import preview' })).toBeVisible();
  await expect(page.getByText(/2 games/)).toBeVisible();
  await page.getByRole('button', { name: 'Create repertoire' }).click();

  await expect(page.getByRole('heading', { name: 'Opening training' })).toBeVisible();
  await expect(page.getByText('E2E White')).toBeVisible();
}

async function clickSquare(page: Page, square: string) {
  const board = page.locator('#opening-training-board');
  await expect(board).toBeVisible();
  const box = await board.boundingBox();
  if (!box) throw new Error('Opening training board has no bounding box.');

  const file = square.charCodeAt(0) - 'a'.charCodeAt(0);
  const rank = Number(square[1]);
  const squareSize = box.width / 8;
  await board.click({
    position: {
      x: (file + 0.5) * squareSize,
      y: (8 - rank + 0.5) * squareSize,
    },
  });
}

test('imports a multi-game PGN, persists it, records a Practice Line attempt, and retains it after reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Train' })).toHaveAttribute('aria-selected', 'true');

  await importWhiteRepertoire(page);

  await page.reload();
  await expect(page.getByText('E2E White')).toBeVisible();
  await page.getByRole('radio', { name: /E2E White/ }).check();
  await page.getByRole('button', { name: 'Practice Line' }).click();

  await expect(page.getByText('Practice Line')).toBeVisible();
  await clickSquare(page, 'e2');
  await clickSquare(page, 'e4');
  await expect(page.getByText(/^Correct\.$/)).toBeVisible();

  await page.getByRole('tab', { name: 'Data' }).click();
  await expect(page.getByText(/1 attempts · 1 sessions/)).toBeVisible();
  await expect(page.getByText('E2E White')).toBeVisible();

  await page.reload();
  await page.getByRole('tab', { name: 'Data' }).click();
  await expect(page.getByText(/1 attempts · 1 sessions/)).toBeVisible();
  await expect(page.getByText('E2E White')).toBeVisible();
});

test('launches Quick Recall from the built-in demo without depending on random prompt selection', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try Demo' }).click();
  await expect(page.getByText('Practice Line')).toBeVisible();
  await expect(page.locator('#opening-training-board')).toBeVisible();

  await page.getByRole('button', { name: 'Exit session' }).click();
  await expect(page.getByRole('heading', { name: 'Opening training' })).toBeVisible();
  await page.getByRole('button', { name: 'Quick Recall' }).click();

  await expect(page.getByText('Quick Recall')).toBeVisible();
  await expect(page.getByLabel('Session progress')).toBeVisible();
  await expect(page.locator('#opening-training-board')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hint' })).toBeEnabled();
});

test('keeps Train, import, and trainer surfaces within a 320px viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Train' })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Import PGN' }).click();
  await expect(page.getByRole('heading', { name: 'Import PGN' })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Try Demo' }).click();
  await expect(page.locator('#opening-training-board')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
