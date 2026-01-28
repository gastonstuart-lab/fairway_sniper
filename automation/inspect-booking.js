// Simple script to open booking page and wait for manual inspection
// Run with: node inspect-booking.js

import { chromium } from '@playwright/test';
import fs from 'fs';

(async () => {
  console.log('🚀 Launching browser...');

  const browser = await chromium.launch({
    headless: false,
    slowMo: 500, // Slow down actions
  });

  // Load saved authentication state
  const stateJson = JSON.parse(fs.readFileSync('./state.json', 'utf-8'));
  const context = await browser.newContext({ storageState: stateJson });
  const page = await context.newPage();

  console.log('🏠 Navigating to Galgorm home page...');
  await page.goto('https://members.brsgolf.com/galgorm');

  await page.waitForTimeout(2000);
  console.log('✅ Home page loaded');

  console.log('📅 Now navigating to tee sheet...');
  await page.goto('https://members.brsgolf.com/galgorm/members/booking');

  await page.waitForTimeout(3000);
  console.log('✅ Tee sheet loaded');

  console.log('\n==================================================');
  console.log('🔍 INSPECTION MODE - MANUAL NAVIGATION REQUIRED');
  console.log('==================================================');
  console.log('The browser will stay open for 10 minutes.');
  console.log('\nPlease manually do the following:');
  console.log('  1. Find an available tee time on the sheet');
  console.log('  2. Click the "Book" button for that time');
  console.log('  3. This will take you to the booking form');
  console.log('  4. On the booking form, click on Player 2 input field');
  console.log('  5. Wait for the dropdown with player names to appear');
  console.log('  6. Right-click → Inspect Element on a player name');
  console.log('  7. Tell me what HTML elements/classes you see');
  console.log('\nPress Ctrl+C when done inspecting.');
  console.log('==================================================\n');

  // Wait 10 minutes
  await page.waitForTimeout(600000);

  await browser.close();
})();
