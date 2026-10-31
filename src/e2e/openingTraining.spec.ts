import { expect, test, type Page } from '@playwright/test';

const IMPORT_PGN = `[Event "E2E A"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 *

[Event "E2E B"]
[Result "*"]

1. e4 c5 2. Nf3 d6 *`;

const BOARD = '#opening-training-board-board';
const REVIEW_BOARD = '#review-training-board-board';


async function clickReviewSquare(page: Page, square: string) {
  const board = page.locator(REVIEW_BOARD);
  await expect(board).toBeVisible();
  await page.locator(`#review-training-board-square-${square}`).click();
}

async function playReviewMove(page: Page, from: string, to: string) {
  await clickReviewSquare(page, from);
  await clickReviewSquare(page, to);
}

async function importSingleRepertoire(
  page: Page,
  input: { name: string; side: 'White' | 'Black'; pgn: string },
) {
  await page.getByRole('button', { name: 'Import PGN' }).click();
  await page.getByLabel('PGN file').setInputFiles({
    name: `${input.name}.pgn`,
    mimeType: 'application/x-chess-pgn',
    buffer: Buffer.from(input.pgn),
  });
  await page.getByLabel('Repertoire name').fill(input.name);
  await page.getByRole('radio', { name: input.side, exact: true }).check();
  await page.getByRole('button', { name: 'Preview import' }).click();
  await expect(page.getByRole('heading', { name: 'Import preview' })).toBeVisible();
  await page.getByRole('button', { name: 'Create repertoire' }).click();
  await expect(page.getByRole('heading', { name: 'Opening training' })).toBeVisible();
  await expect(page.getByRole('radio', { name: new RegExp(input.name) })).toBeVisible();
}

async function createDemoAndReturnHome(page: Page) {
  await page.getByRole('button', { name: 'Try Demo' }).click();
  await expect(page.locator(BOARD)).toBeVisible();
  await page.getByRole('button', { name: 'Exit session' }).click();
  await expect(page.getByRole('heading', { name: 'Opening training' })).toBeVisible();
}

async function reviewOverview(page: Page) {
  const label = page.getByText(/\d+ due · \d+ new available/);
  await expect(label).toBeVisible();
  const text = await label.textContent();
  const match = text?.match(/(\d+) due · (\d+) new available/);
  if (!match) throw new Error(`Could not parse Review Due overview: ${text}`);
  return { due: Number(match[1]), newAvailable: Number(match[2]) };
}

async function markFirstScheduledCardDue(page: Page) {
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('chess-decision-trainer');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction('repertoireMoveMastery', 'readwrite');
        const store = transaction.objectStore('repertoireMoveMastery');
        const getAll = store.getAll();

        getAll.onerror = () => reject(getAll.error);
        getAll.onsuccess = () => {
          const scheduled = getAll.result.find(
            (row: any) => row?.schedulingData?.kind === 'fsrs',
          );
          if (!scheduled) {
            reject(new Error('No scheduled review card found.'));
            return;
          }
          const due = '2020-01-01T00:00:00.000Z';
          scheduled.nextReviewAt = due;
          scheduled.schedulingData = {
            ...scheduled.schedulingData,
            card: {
              ...scheduled.schedulingData.card,
              due,
            },
          };
          store.put(scheduled);
        };
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      };
    });
  });
}

async function reviewBoardOrientation(page: Page): Promise<'white' | 'black'> {
  const a1 = await page.locator('#review-training-board-square-a1').boundingBox();
  const h8 = await page.locator('#review-training-board-square-h8').boundingBox();
  if (!a1 || !h8) throw new Error('Review board squares are not measurable.');
  return a1.y > h8.y ? 'white' : 'black';
}

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
  await expect(page.getByRole('radio', { name: /E2E White/ })).toBeVisible();
}

async function clickSquare(page: Page, square: string) {
  const board = page.locator(BOARD);
  await expect(board).toBeVisible();
  await page.locator(`#opening-training-board-square-${square}`).click();
}

test('imports a multi-game PGN, persists it, records a Practice Line attempt, and retains it after reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Train' })).toHaveAttribute('aria-selected', 'true');

  await importWhiteRepertoire(page);

  await page.reload();
  await expect(page.getByRole('radio', { name: /E2E White/ })).toBeVisible();
  await page.getByRole('radio', { name: /E2E White/ }).check();
  await page.getByRole('button', { name: 'Practice Line' }).click();

  await expect(page.locator(BOARD)).toBeVisible();
  await expect(page.getByText('Practice Line', { exact: true })).toBeVisible();
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
  await expect(page.locator(BOARD)).toBeVisible();
  await expect(page.getByText('Practice Line', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Exit session' }).click();
  await expect(page.getByRole('heading', { name: 'Opening training' })).toBeVisible();
  await page.getByRole('button', { name: 'Quick Recall' }).click();

  await expect(page.getByText('Quick Recall')).toBeVisible();
  await expect(page.getByLabel('Session progress')).toBeVisible();
  await expect(page.locator(BOARD)).toBeVisible();
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
  await expect(page.locator(BOARD)).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Exit session' }).click();
  await page.getByRole('button', { name: 'Review Due' }).click();
  await expect(page.locator(REVIEW_BOARD)).toBeVisible();
  await expectNoHorizontalOverflow(page);
});


test('Review Due persists settings, a new schedule, and an overdue schedule across reloads', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Review Due' })).toBeVisible();

  await createDemoAndReturnHome(page);
  const before = await reviewOverview(page);
  expect(before.newAvailable).toBeGreaterThan(0);

  await page.getByLabel('New items per day').fill('12');
  await page.getByLabel('Review batch size').fill('6');
  await page.getByRole('button', { name: 'Save review settings' }).click();

  await page.getByRole('button', { name: 'Review Due' }).click();
  await expect(page.locator(REVIEW_BOARD)).toBeVisible();
  await playReviewMove(page, 'e2', 'e4');
  await expect(page.getByLabel('Review session progress')).toHaveText(/1 \/ \d+/);
  await page.getByRole('button', { name: 'Exit session' }).click();

  const after = await reviewOverview(page);
  expect(after.newAvailable).toBe(before.newAvailable - 1);

  await page.reload();
  await expect(page.getByLabel('New items per day')).toHaveValue('12');
  await expect(page.getByLabel('Review batch size')).toHaveValue('6');
  await expect(page.getByText(`${after.due} due · ${after.newAvailable} new available`))
    .toBeVisible();

  await markFirstScheduledCardDue(page);
  await page.reload();
  const dueAfterReload = await reviewOverview(page);
  expect(dueAfterReload.due).toBeGreaterThanOrEqual(1);

  await page.reload();
  expect((await reviewOverview(page)).due).toBe(dueAfterReload.due);
});

test('global Review Due changes board orientation when it crosses White and Black repertoires', async ({ page }) => {
  await page.goto('/');
  await importSingleRepertoire(page, {
    name: 'E2E White Review',
    side: 'White',
    pgn: '[Event "White Review"]\n[Result "*"]\n\n1. e4 *',
  });
  await importSingleRepertoire(page, {
    name: 'E2E Black Review',
    side: 'Black',
    pgn: '[Event "Black Review"]\n[Result "*"]\n\n1. e4 c5 *',
  });

  await expect(page.getByText('0 due · 2 new available')).toBeVisible();
  await page.getByRole('button', { name: 'Review Due' }).click();
  await expect(page.locator(REVIEW_BOARD)).toBeVisible();

  const firstName = await page.locator('.review-trainer h2').textContent();
  const firstOrientation = await reviewBoardOrientation(page);

  if (firstName === 'E2E White Review') {
    expect(firstOrientation).toBe('white');
    await playReviewMove(page, 'e2', 'e4');
    await expect(page.locator('.review-trainer h2')).toHaveText('E2E Black Review');
    expect(await reviewBoardOrientation(page)).toBe('black');
  } else {
    expect(firstName).toBe('E2E Black Review');
    expect(firstOrientation).toBe('black');
    await playReviewMove(page, 'c7', 'c5');
    await expect(page.locator('.review-trainer h2')).toHaveText('E2E White Review');
    expect(await reviewBoardOrientation(page)).toBe('white');
  }
});

test('Review Due reports an accepted alternative as correct while naming the preferred move', async ({ page }) => {
  await page.goto('/');
  await importSingleRepertoire(page, {
    name: 'E2E Alternatives',
    side: 'White',
    pgn: '[Event "Alternatives"]\n[Result "*"]\n\n1. e4 (1. d4) e5 2. Nf3 *',
  });

  await page.getByRole('button', { name: 'Review Due' }).click();
  await expect(page.locator(REVIEW_BOARD)).toBeVisible();
  await playReviewMove(page, 'd2', 'd4');

  await expect(page.getByText('Correct — accepted alternative.', { exact: true })).toBeVisible();
  await expect(page.getByText('Preferred: e4', { exact: true })).toBeVisible();
  await expect(page.getByText('Grade: hard', { exact: true })).toBeVisible();
});

test('failed scheduled recall waits for three prompts and two minutes before relearning', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-31T12:00:00.000Z') });
  await page.goto('/');
  await createDemoAndReturnHome(page);

  await page.getByRole('button', { name: 'Review Due' }).click();
  await expect(page.locator(REVIEW_BOARD)).toBeVisible();

  await playReviewMove(page, 'd2', 'd4');
  await expect(page.getByText('Not quite. Look again.', { exact: true })).toBeVisible();
  await playReviewMove(page, 'e2', 'e4');
  await expect(page.getByLabel('Review session progress')).toHaveText(/1 \/ \d+/);
  await expect(page.getByText('Review Due · Relearning', { exact: true })).toHaveCount(0);

  await playReviewMove(page, 'g1', 'f3');
  await expect(page.getByLabel('Review session progress')).toHaveText(/2 \/ \d+/);
  await expect(page.getByText('Review Due · Relearning', { exact: true })).toHaveCount(0);

  await playReviewMove(page, 'g1', 'f3');
  await expect(page.getByLabel('Review session progress')).toHaveText(/3 \/ \d+/);
  await expect(page.getByText('Review Due · Relearning', { exact: true })).toHaveCount(0);

  await page.clock.fastForward(121_000);
  await playReviewMove(page, 'f1', 'c4');
  await expect(page.getByLabel('Review session progress')).toHaveText(/4 \/ \d+/);
  await expect(page.getByText('Review Due · Relearning', { exact: true })).toBeVisible();

  await playReviewMove(page, 'e2', 'e4');
  await expect(page.getByText(/relearned/)).toBeVisible();
});
