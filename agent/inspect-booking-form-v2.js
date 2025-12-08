#!/usr/bin/env node

import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const INSPECTION_OUTPUT = 'inspection-output';
const USERNAME = '12390624';
const PASSWORD = 'cantona7777';

if (!fs.existsSync(INSPECTION_OUTPUT)) {
  fs.mkdirSync(INSPECTION_OUTPUT, { recursive: true });
}

async function main() {
  let browser;

  try {
    console.log(`\n🔍 BRS BOOKING FORM INSPECTOR
════════════════════════════════════\n`);

    // Step 1: Launch browser
    console.log('1️⃣  Launching browser...');
    browser = await chromium.launch({
      headless: false, // Show browser so we can see what's happening
      args: ['--disable-blink-features=AutomationControlled'],
    });

    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      viewport: { width: 1280, height: 720 },
    });

    const page = await context.newPage();

    // Step 2: Navigate to login
    console.log('2️⃣  Navigating to login page...');
    await page.goto('https://members.brsgolf.com/galgorm/login', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Step 3: Accept cookies
    console.log('3️⃣  Accepting cookies...');
    const cookieBtn = page
      .locator('button:has-text("Accept"), button:has-text("I Agree")')
      .first();
    if (await cookieBtn.isVisible().catch(() => false)) {
      await cookieBtn.click();
    }

    // Step 4: Login
    console.log('4️⃣  Logging in...');
    await page
      .getByPlaceholder(/8 digit GUI|ILGU|username/i)
      .first()
      .fill(USERNAME);
    await page.getByPlaceholder(/password/i).first().fill(PASSWORD);
    await page.getByRole('button', { name: /login/i }).first().click();
    await page.waitForTimeout(3000);

    // Step 5: Navigate to tee sheet
    console.log('5️⃣  Navigating to tee sheet...');
    const teeSheetUrl = 'https://members.brsgolf.com/galgorm/tee-sheet/1/2025/12/09';
    await page.goto(teeSheetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    console.log(`   URL: ${teeSheetUrl}`);

    // Step 6: Wait for booking links to appear (same as fetchAvailableTeeTimesFromBRS)
    console.log('6️⃣  Waiting for tee times to render...');
    const pollTimeout = 20000;
    const start = Date.now();
    let count = 0;
    while (Date.now() - start < pollTimeout) {
      count = await page.locator('a[href*="/bookings/book/"]').count();
      if (count > 0) break;
      await page.waitForTimeout(300);
    }
    console.log(`   ✅ Found ${count} booking links`);

    if (count === 0) {
      console.error('❌ No tee time booking links found!');
      await browser.close();
      return;
    }

    // Step 7: Click first available booking link
    console.log('7️⃣  Clicking on first available tee time...');
    const firstBookingLink = page.locator('a[href*="/bookings/book/"]').first();
    const firstHref = await firstBookingLink.getAttribute('href');
    console.log(`   First booking link: ${firstHref}`);
    
    await firstBookingLink.click({ timeout: 10000 });
    await page.waitForTimeout(2000);

    // Step 8: Extract booking form HTML
    console.log('8️⃣  Extracting booking form...');
    const formHTML = await page.content();

    // Save raw HTML
    const htmlFile = path.join(INSPECTION_OUTPUT, 'booking-form.html');
    fs.writeFileSync(htmlFile, formHTML);
    console.log(`   ✅ Saved: ${htmlFile}`);

    // Step 9: Take screenshot
    const screenshotFile = path.join(INSPECTION_OUTPUT, 'booking-form.png');
    await page.screenshot({ path: screenshotFile, fullPage: true });
    console.log(`   ✅ Saved: ${screenshotFile}`);

    // Step 10: Parse form structure
    console.log('9️⃣  Analyzing form structure...');

    // Find all selects and their options
    const selectElements = await page.locator('select').all();
    console.log(`\n   Found ${selectElements.length} SELECT elements:\n`);

    const selectInfo = [];
    for (let i = 0; i < selectElements.length; i++) {
      const select = selectElements[i];
      const selectId = await select.getAttribute('id');
      const selectName = await select.getAttribute('name');
      const selectClass = await select.getAttribute('class');

      console.log(`   [SELECT ${i}]`);
      console.log(`     - ID: ${selectId}`);
      console.log(`     - Name: ${selectName}`);
      console.log(`     - Class: ${selectClass}`);

      // Get options
      const options = await select.locator('option').all();
      console.log(`     - Options (${options.length}):`);
      const optionsList = [];
      for (const option of options) {
        const text = await option.textContent();
        const value = await option.getAttribute('value');
        console.log(`       • ${text.trim()} (value: ${value})`);
        optionsList.push({ text: text.trim(), value });
      }

      selectInfo.push({
        index: i,
        id: selectId,
        name: selectName,
        class: selectClass,
        options: optionsList,
      });
    }

    // Find all buttons
    const buttons = await page.locator('button').all();
    console.log(`\n   Found ${buttons.length} BUTTON elements:\n`);

    for (let i = 0; i < buttons.length; i++) {
      const button = buttons[i];
      const text = await button.textContent();
      const type = await button.getAttribute('type');
      const id = await button.getAttribute('id');
      const name = await button.getAttribute('name');

      console.log(`   [BUTTON ${i}]`);
      console.log(`     - Text: ${text.trim()}`);
      console.log(`     - Type: ${type}`);
      console.log(`     - ID: ${id}`);
      console.log(`     - Name: ${name}`);
    }

    // Save analysis as JSON
    const analysisFile = path.join(INSPECTION_OUTPUT, 'form-analysis.json');
    const analysis = {
      timestamp: new Date().toISOString(),
      url: page.url(),
      selectElements: selectInfo,
      totalSelects: selectElements.length,
      totalButtons: buttons.length,
      notes:
        'Use these select IDs/names to populate player selections in tryBookTime()',
    };
    fs.writeFileSync(analysisFile, JSON.stringify(analysis, null, 2));
    console.log(`\n   ✅ Saved analysis: ${analysisFile}`);

    console.log('\n✅ INSPECTION COMPLETE\n');
    console.log(`   Output files saved to: ${path.resolve(INSPECTION_OUTPUT)}\n`);

    await browser.close();
  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    if (browser) await browser.close();
    process.exit(1);
  }
}

main();
