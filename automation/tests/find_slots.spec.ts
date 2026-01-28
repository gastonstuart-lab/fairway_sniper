import { test, expect } from '@playwright/test';
import { waitForTeeSheet } from './helpers.js';

// Use the authenticated storage state saved by the login test
test.use({ storageState: 'state.json' });

test('scrape visible tee times and their action labels', async ({ page }) => {
  // Navigate to the Galgorm tee sheet
  await page.goto('https://members.brsgolf.com/galgorm/tee-sheet/1');
  await waitForTeeSheet(page);

  // Wait for the tee sheet UI to be ready using the robust helper
  await waitForTeeSheet(page);

  // Wait for tee-time rows to appear. Use a broad selector that matches common patterns.
  const rows = page.locator(
    '.tee-row, .tee-time-row, .slot-row, tr.tee-row, .tee-time, .slot, .timeslot',
  );
  // give the rows a chance to render if the tee sheet signaled ready
  await rows
    .first()
    .waitFor({ state: 'visible', timeout: 10000 })
    .catch(() => {});

  const count = await rows.count();
  const results: string[] = [];

  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);

    // Wait for any time text like 07:56 inside the row
    const timeLocator = row.locator('text=/^s*\\d{1,2}:\\d{2}/');
    if ((await timeLocator.count()) === 0) {
      // Try a looser match if strict one fails
      const altTime = row.locator('text=/\\d{1,2}:\\d{2}/');
      if ((await altTime.count()) === 0) continue; // skip rows without a time
      const timeText = (await altTime.first().innerText()).trim();
      // Find label/button for this row
      let label = await extractLabel(row);
      results.push(`${timeText} — ${label}`);
      continue;
    }

    const timeText = (await timeLocator.first().innerText()).trim();

    // Extract the visible action label for the row: prefer button text but fall back to plain text
    const label = await extractLabel(row);
    results.push(`${timeText} — ${label}`);
  }

  // Log results
  if (results.length === 0) {
    console.log('No tee-time rows found or no visible times detected.');
  } else {
    for (const line of results) console.log(line);
  }

  // Helper: extract a human-friendly label for the row
  async function extractLabel(
    rowLocator: import('@playwright/test').Locator,
  ): Promise<string> {
    // Try common button selectors first
    const btn = rowLocator
      .locator('button, a.button, button.mat-button, button.mat-raised-button')
      .first();
    if ((await btn.count()) > 0) {
      const text = (await btn.innerText()).trim();
      if (text) return text;
    }

    // Fallback: look for known status text inside the row
    const status = rowLocator
      .locator('text=/Waiting List|Waiting list|Book(ed)?|Booked|Book/i')
      .first();
    if ((await status.count()) > 0) {
      const s = (await status.innerText()).trim();
      if (s) return s;
    }

    // Last resort: return first non-empty text node from the row
    const rowText = (await rowLocator.innerText()).trim().replace(/\s+/g, ' ');
    // Try to extract a likely label (words after the time)
    const afterTime = rowText.replace(/^.*?\d{1,2}:\d{2}\s*/, '').trim();
    if (afterTime) return afterTime.split(' ').slice(0, 3).join(' ');
    return 'Unknown';
  }
});
