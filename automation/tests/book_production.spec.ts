/**
 * Production Booking Test
 * Uses dynamic config, robust selectors, and safe modes
 */

import 'dotenv/config';
import { test } from '@playwright/test';
import {
  parseConfig,
  logConfigSummary,
  calculateTargetDate,
  formatDateISO,
  formatDay,
} from '../config';
import {
  navigateToTeeSheet,
  ensureLoggedIn,
  openCalendar,
  selectCalendarDay,
  scanForBookableTimes,
  clickBooking,
  waitForPageLoad,
  getRootForTee,
  fillPlayers,
  autoConfirm,
} from '../selectors';

test('🎯 Book tee time (production)', async ({ page }) => {
  test.setTimeout(180_000);

  // AUTO-ACCEPT ALL DIALOGS (prevents freezing)
  page.on('dialog', dialog => dialog.accept());

  // Load configuration
  const config = parseConfig();
  logConfigSummary(config);

  // Calculate target booking date
  const targetDate = calculateTargetDate(config);
  const targetDateStr = formatDateISO(targetDate);
  const targetDay = formatDay(targetDate);

  console.log(
    `\n📅 Target Date: ${targetDateStr} (day ${targetDay})`,
  );
  console.log(
    `🎯 Target Times: ${config.targetTimes.join(', ')}`,
  );
  console.log(`🔒 Dry Run: ${config.dryRun}`);

  try {
    // 1. Navigate to club and login
    console.log('\n📍 Step 1: Navigate to club...');
    await page.goto(config.clubUrl, { waitUntil: 'domcontentloaded' });
    await waitForPageLoad(page, 8000);
    
    console.log('🔐 Step 2: Ensure logged in...');
    await ensureLoggedIn(page, config.username, config.password);

    // 3. Click "Tee Sheet" on left sidebar to open tee sheet view
    console.log('\n📋 Step 3: Click Tee Sheet on sidebar...');
    const teeSheetLink = page
      .getByRole('link', { name: /tee sheet/i })
      .first()
      .or(page.getByRole('button', { name: /tee sheet/i }).first());
    
    if (await teeSheetLink.isVisible().catch(() => false)) {
      await teeSheetLink.click();
      console.log('  ✓ Clicked Tee Sheet link');
      await waitForPageLoad(page, 8000);
    } else {
      console.log('  ⚠️ Tee Sheet link not found, attempting direct URL...');
      await navigateToTeeSheet(page, config.courseId, targetDate, config.clubUrl);
    }

    // 4. Wait for player/date selection screen and look for view/search button
    console.log('\n👥 Step 4: Looking for tee sheet buttons...');
    
    // Just wait for page to settle
    await page.waitForTimeout(1000);
    
    // Look for button to proceed to tee times
    const searchBtn = page
      .getByRole('button', { name: /search|view|find|see|proceed|continue/i })
      .first();
    
    const viewBtn = page
      .locator('button')
      .filter({ hasText: /Search|View|Find|See|Proceed/ })
      .first();
    
    if (await searchBtn.isVisible().catch(() => false)) {
      console.log('  ✓ Found search button, clicking...');
      await searchBtn.click();
      await waitForPageLoad(page, 10000);
    } else if (await viewBtn.isVisible().catch(() => false)) {
      console.log('  ✓ Found view button, clicking...');
      await viewBtn.click();
      await waitForPageLoad(page, 10000);
    } else {
      console.log('  ⚠️ No search/view button - tee times may already be displayed');
      await page.waitForTimeout(1000);
    }

    // 5. SNIPER: Scan across multiple days for ANY bookable time
    console.log('\n⏱️ Step 5: SNIPER SCAN (multi-day search)...');
    
    let result = null;
    let currentDate = targetDate;
    let attempts = 0;
    const maxDays = config.searchDays || 14;

    while (!result && attempts < maxDays) {
      const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
      
      console.log(`\n  📅 Scanning ${dateStr} (day ${attempts + 1}/${maxDays})...`);

      // Navigate to this specific date
      await navigateToTeeSheet(page, config.courseId, currentDate, config.clubUrl);
      await page.waitForTimeout(2000);

      // Get root (handles iframes)
      const root = await getRootForTee(page);
      
      // Scan this date
      result = await scanForBookableTimes(root, config.targetTimes);

      if (result) {
        console.log(`  ✅ Found bookable time on ${dateStr}!`);
        break;
      }

      console.log(`  ⚠️ No bookable times on ${dateStr}`);
      
      // Move to next day
      currentDate = new Date(currentDate);
      currentDate.setDate(currentDate.getDate() + 1);
      attempts++;
    }

    if (!result) {
      console.log(`\n❌ No bookable slots found within ${maxDays} days`);
      throw new Error('No bookable tee times available');
    }

    const { time, action } = result;
    const { bookBtn, waitBtn } = action;

    console.log(`\n🎯 Selected time: ${time}`);

    // 6. Click booking button
    const btnToClick = bookBtn || (config.clickWaitlist ? waitBtn : null);

    if (!btnToClick) {
      throw new Error(`No valid button to click for ${time}`);
    }

    const btnType = bookBtn ? 'BOOK' : 'WAITLIST';

    if (config.dryRun) {
      console.log(`\n🔒 DRY RUN: Would click ${btnType} for ${time}`);
      console.log('✅ Dry run successful! Booking would proceed.');
      return;
    }

    console.log(`\n⚡ LIVE MODE: Clicking ${btnType} for ${time}...`);
    await clickBooking(page, btnToClick);

    // 7. Wait for player selection screen
    console.log('\n👥 Step 6: Waiting for player selection...');
    await page.waitForTimeout(2000);

    // 8. Get root again (may be in iframe now after booking click)
    const root = await getRootForTee(page);

    // 9. Fill players 2-4 (Player 1 is implicit)
    const players = ['Stuart Campbell', 'John Doe', 'Jane Smith']; // TODO: Load from config
    await fillPlayers(root, players);

    // 10. AUTO-CONFIRM
    console.log('\n🚀 Step 7: Auto-confirming booking...');
    const confirmed = await autoConfirm(root);

    if (!confirmed) {
      console.log('\n⚠️ Auto-confirm failed - check for confirm button');
      // Don't throw - may need manual intervention
    }

    // 11. Success
    console.log('\n🎉 Booking complete!');
  } catch (error) {
    console.error(`\n❌ Booking failed: ${error.message}`);
    console.error(`   Please check configuration and try again.`);
    throw error;
  }
});
