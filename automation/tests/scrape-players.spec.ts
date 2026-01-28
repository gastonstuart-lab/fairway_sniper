import { test, expect } from '@playwright/test';
import { ensureLoggedIn, waitForTeeSheet } from './helpers';
import fs from 'fs';
import path from 'path';

/**
 * Scrapes the complete player directory from BRS Golf booking system
 *
 * This test:
 * 1. Logs into BRS Golf (or uses existing auth state)
 * 2. Navigates to the tee sheet
 * 3. Clicks on ANY available "Book" button to open a booking form
 *    (NOTE: You can't navigate directly to /bookings - must select a tee time first!)
 * 4. On the booking form, clicks Player 2 input field to trigger autocomplete
 * 5. Extracts all player names from the dropdown
 * 6. Saves to automation/players.json for use by agent and Flutter UI
 *
 * Run with: npx playwright test tests/scrape-players.spec.ts --headed
 */

test.describe('Player Directory Scraper', () => {
  test('scrape all available player names from booking form', async ({
    page,
  }) => {
    console.log('🔐 Logging in to BRS Golf...');

    // Start at the main site
    await page.goto('https://members.brsgolf.com/galgorm');
    await ensureLoggedIn(page);

    console.log('📅 Navigating to tee sheet for today...');
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    const teeSheetUrl = `https://members.brsgolf.com/galgorm/tee-sheet/1/${y}/${m}/${d}`;

    console.log(`🔗 Tee sheet URL: ${teeSheetUrl}`);
    await page.goto(teeSheetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    await waitForTeeSheet(page);
    console.log('✅ Tee sheet loaded');

    // Find ANY available/bookable tee time (we just need to get to a booking form)
    // Look for a table with tee times and find a row with a "Book" button
    console.log('🔍 Looking for tee time table...');

    const table = page.locator('table:has(tr), [role="grid"]:has(tr)').first();
    if (!(await table.isVisible().catch(() => false))) {
      throw new Error('Tee time table not found');
    }

    const rows = table.locator('tbody tr, tr');
    const rowCount = await rows.count();
    console.log(`Found ${rowCount} rows in tee time table`);

    // Find first row with a "Book" button/link
    let bookButton: any = null;
    let foundTime = '';

    for (let i = 0; i < rowCount; i++) {
      const row = rows.nth(i);
      const firstCell = row.locator('td, [role="gridcell"]').first();
      const timeText = (await firstCell.innerText().catch(() => '')).trim();

      // Check if this row has a Book button
      const actionCell = row.locator('td, [role="gridcell"]').nth(1).or(row);
      const btn = actionCell
        .locator(':is(button,a,[role="button"]):has-text(/\\bbook\\b/i)')
        .first();

      if (await btn.isVisible().catch(() => false)) {
        bookButton = btn;
        foundTime = timeText;
        console.log(`✅ Found bookable tee time: ${timeText}`);
        break;
      }
    }

    if (!bookButton) {
      console.log('❌ No bookable tee times found');
      await page.screenshot({
        path: 'output/no-bookable-times.png',
        fullPage: true,
      });
      throw new Error('No tee times with Book buttons found');
    }

    console.log(`🖱️  Clicking Book button for time ${foundTime}...`);
    await bookButton.click();

    // Wait for page to load/navigate
    await page.waitForTimeout(3000);

    const currentUrl = page.url();
    console.log('✅ Current URL after Book click:', currentUrl);

    // Check if we're on a booking page or if a modal appeared
    const isBookingPage =
      currentUrl.includes('/bookings') || currentUrl.includes('/book');
    console.log(
      isBookingPage
        ? '📝 Navigated to booking page'
        : '📝 Booking form/modal should be visible',
    );

    await page.waitForTimeout(1000);

    // Look for Player 2 input (Player 1 is auto-filled)
    console.log('🔍 Looking for Player 2 input field...');

    // Try multiple strategies to find the player input
    // Strategy 1: Look for text "Player 2" and find nearby input
    let player2Input = page
      .locator('text=Player 2')
      .locator('..')
      .locator('input');
    let found = await player2Input.isVisible().catch(() => false);

    if (!found) {
      // Strategy 2: Look for input with placeholder about typing/finding player
      console.log('Strategy 1 failed, trying placeholder-based selector...');
      player2Input = page
        .locator(
          'input[placeholder*="typing" i], input[placeholder*="find player" i]',
        )
        .first();
      found = await player2Input.isVisible().catch(() => false);
    }

    if (!found) {
      // Strategy 3: Look for any input field (Player 2 is likely the 2nd or 3rd input on the page)
      console.log('Strategy 2 failed, trying to find inputs by index...');
      const allInputs = await page.locator('input[type="text"]').all();
      console.log(`Found ${allInputs.length} text inputs on page`);
      // Try the second text input (first is probably Player 1 which is auto-filled)
      if (allInputs.length >= 2) {
        player2Input = page.locator('input[type="text"]').nth(1);
        found = await player2Input.isVisible().catch(() => false);
      }
    }

    if (!found) {
      console.log('❌ Could not find Player 2 input - taking screenshot');
      await page.screenshot({
        path: 'output/no-player2-input.png',
        fullPage: true,
      });
      throw new Error('Player 2 input field not found - check screenshot');
    }

    console.log('✅ Found Player 2 input');

    // Click to focus and trigger dropdown
    console.log('🖱️  Clicking Player 2 input to show player list...');
    await player2Input.click();
    await page.waitForTimeout(1500); // Wait for dropdown/list to populate

    // The dropdown contains hundreds of names and is scrollable
    // Extract all visible player names from the dropdown
    console.log('📋 Extracting player names from scrollable dropdown...');

    const players = await page.evaluate(async () => {
      const names: string[] = [];

      // Find the dropdown container - it should be visible after clicking the input
      // Look for common dropdown/listbox containers
      const dropdownSelectors = [
        '[role="listbox"]',
        '.dropdown-menu',
        '.autocomplete-panel',
        '.player-dropdown',
        'ul[class*="dropdown"]',
        'div[class*="dropdown"]',
        'div[class*="menu"]',
      ];

      let dropdown: Element | null = null;
      for (const selector of dropdownSelectors) {
        dropdown = document.querySelector(selector);
        if (dropdown && dropdown.children.length > 0) {
          console.log(
            `Found dropdown with selector: ${selector}, ${dropdown.children.length} children`,
          );
          break;
        }
      }

      if (!dropdown) {
        // Fallback: look for any visible element with lots of text items
        console.log(
          'Dropdown container not found with standard selectors, using fallback',
        );
      }

      // Extract all text that looks like player names (Lastname, Firstname pattern)
      const allText = document.body.innerText;
      const lines = allText.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        // Player names match: "Lastname, Firstname" or "Lastname, Firstname Initial"
        // Examples: "Bell, Roy" or "Crawford, William A"
        if (trimmed.match(/^[A-Z][a-zA-Z'-]+,\s+[A-Z]/)) {
          if (!names.includes(trimmed)) {
            names.push(trimmed);
          }
        }
      }

      console.log(`Extracted ${names.length} total player names`);
      return names.sort();
    });

    console.log(
      `✅ Found ${players.length} player names (including friends/buddies and all members)`,
    );

    if (players.length === 0) {
      console.log('❌ No players found - taking screenshot');
      await page.screenshot({
        path: 'output/no-players-found.png',
        fullPage: true,
      });
      throw new Error('No player names found - check screenshot');
    }

    // Log sample
    console.log('Sample players:');
    players.slice(0, 10).forEach((name, i) => {
      console.log(`  ${i + 1}. ${name}`);
    });

    // Save to JSON
    const outputPath = path.join(__dirname, '..', 'players.json');
    const data = {
      scrapedAt: new Date().toISOString(),
      count: players.length,
      players: players,
    };

    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`💾 Saved ${players.length} players to ${outputPath}`);
    console.log('✨ Player scraping complete!');
  });
});
