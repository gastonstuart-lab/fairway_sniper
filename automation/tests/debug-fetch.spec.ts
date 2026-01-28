import { test, expect } from '@playwright/test';

test.use({ storageState: 'state.json' });

test('debug tee sheet structure', async ({ page }) => {
  // Navigate to tomorrow's tee sheet
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const y = tomorrow.getFullYear();
  const m = String(tomorrow.getMonth() + 1).padStart(2, '0');
  const d = String(tomorrow.getDate()).padStart(2, '0');

  const url = `https://members.brsgolf.com/galgorm/tee-sheet/1/${y}/${m}/${d}`;
  console.log('Navigating to:', url);

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000); // Wait for page to fully load

  // Check for iframes
  const iframes = await page.locator('iframe').count();
  console.log('Number of iframes:', iframes);

  // Look for time patterns on main page
  const timePattern = /\b(?:0?\d|1\d|2[0-3]):[0-5]\d\b/;
  const timesOnPage = await page.locator(`text=${timePattern}`).count();
  console.log('Time elements on main page:', timesOnPage);

  // Look for buttons with "BOOK" text
  const bookButtons = await page
    .locator('button:has-text("BOOK"), a:has-text("BOOK")')
    .count();
  console.log('Elements with "BOOK" text:', bookButtons);

  // Get sample of BOOK button text content
  const bookButtonTexts = await page
    .locator('button:has-text("BOOK"), a:has-text("BOOK")')
    .allTextContents();
  console.log('BOOK button texts (sample):', bookButtonTexts.slice(0, 10));

  // Get all button text
  const allButtons = await page.locator('button').allTextContents();
  console.log('All buttons on page:', allButtons.slice(0, 20)); // First 20 buttons

  // Check if there's an iframe with tee times
  if (iframes > 0) {
    const frame = page.frameLocator('iframe').first();
    const timesInFrame = await frame
      .locator(`text=${timePattern}`)
      .count()
      .catch(() => 0);
    console.log('Time elements in first iframe:', timesInFrame);

    if (timesInFrame > 0) {
      const frameButtons = await frame
        .locator('button')
        .allTextContents()
        .catch(() => []);
      console.log('Buttons in iframe:', frameButtons.slice(0, 20));
    }
  }

  // Take a screenshot
  await page.screenshot({
    path: 'automation/debug-tee-sheet.png',
    fullPage: true,
  });
  console.log('Screenshot saved to automation/debug-tee-sheet.png');

  // Debug: Check row structure
  console.log('\n=== DEBUGGING ROW STRUCTURE ===');
  const rowSelectors =
    '.tee-row, .tee-time-row, .slot-row, tr.tee-row, .tee-time, .slot, .timeslot, .availability, tr';
  const rows = page.locator(rowSelectors);
  const rowCount = await rows.count();
  console.log('Total rows found:', rowCount);

  // Find where "Book Now" buttons actually are
  console.log('\n=== FINDING BOOK NOW BUTTONS ===');
  const bookNowButtons = page
    .locator('button, a')
    .filter({ hasText: 'Book Now' });
  const bookCount = await bookNowButtons.count();
  console.log('Total "Book Now" buttons (filter):', bookCount);

  if (bookCount > 0) {
    // For Book Now buttons, find the time in the SAME row/cell
    const foundTimes = [];
    for (let i = 0; i < Math.min(15, bookCount); i++) {
      const btn = bookNowButtons.nth(i);

      // Try to find the closest parent that contains ONLY ONE time
      // Usually the button and time are siblings or in nearby cells
      const cellParent = btn
        .locator(
          'xpath=ancestor::td | ancestor::div[contains(@class, "cell")] | ancestor::div[contains(@class, "slot")]',
        )
        .first();

      // Look for HH:MM time format
      const timePattern = /\b(0?\d|1\d|2[0-3]):[0-5]\d\b/;
      const cellText = await cellParent.innerText().catch(() => '');
      const matches = cellText.match(new RegExp(timePattern, 'g'));

      if (matches && matches.length > 0) {
        // If multiple times found, take the first valid tee time (not sunrise)
        for (const match of matches) {
          const time = match.trim();
          // Skip sunrise time (usually 08:15 or similar early time with "sunrise" in parent text)
          if (!cellText.toLowerCase().includes('sunrise')) {
            foundTimes.push(time);
            console.log(`Book Now button ${i}: Time=${time}`);
            break;
          }
        }
      }
    }
    console.log(`\nTotal bookable times found: ${foundTimes.length}`);
    console.log(`Unique times: ${[...new Set(foundTimes)].sort().join(', ')}`);
  }
});
