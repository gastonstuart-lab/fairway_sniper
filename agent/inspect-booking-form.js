import { chromium } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const USERNAME = '12390624';
const PASSWORD = 'cantona7777';

async function inspectBookingForm() {
  console.log('🔍 BRS BOOKING FORM INSPECTOR');
  console.log('═'.repeat(60));

  let browser;
  try {
    // Launch browser (NOT headless so you can see it)
    console.log('\n1️⃣  Launching browser...');
    browser = await chromium.launch({ headless: false });

    const page = await browser.newPage();
    page.setDefaultTimeout(15000);

    // Navigate to login
    console.log('2️⃣  Navigating to login page...');
    await page.goto('https://members.brsgolf.com/galgorm/login');
    await page.waitForTimeout(1000);

    // Accept cookies
    console.log('3️⃣  Accepting cookies...');
    const cookieBtn = page
      .locator('button:has-text("Accept"), button:has-text("I Agree")')
      .first();
    if ((await cookieBtn.count()) > 0) {
      await cookieBtn.click().catch(() => {});
      await page.waitForTimeout(500);
    }

    // Login
    console.log('4️⃣  Logging in as 12390624...');
    await page.getByPlaceholder(/8 digit GUI|ILGU|username/i).fill(USERNAME);
    await page.getByPlaceholder(/password/i).fill(PASSWORD);
    await page.getByRole('button', { name: /login/i }).click();

    // Wait for redirect
    console.log('5️⃣  Waiting for login to complete...');
    await page.waitForURL(/(?!.*\/login)/, { timeout: 20000 });
    await page.waitForTimeout(2000);

    // Navigate to tee sheet (tomorrow)
    console.log('6️⃣  Navigating to tee sheet...');
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const y = tomorrow.getFullYear();
    const m = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const d = String(tomorrow.getDate()).padStart(2, '0');

    const teeSheetUrl = `https://members.brsgolf.com/galgorm/tee-sheet/1/${y}/${m}/${d}`;
    console.log(`   URL: ${teeSheetUrl}`);
    await page.goto(teeSheetUrl);

    // Wait for tee sheet to load
    console.log('7️⃣  Waiting for tee times to appear...');
    const firstTime = page
      .locator('text=/\\b(?:0?\\d|1\\d|2[0-3]):[0-5]\\d\\b/')
      .first();
    await firstTime.waitFor({ timeout: 15000 });
    await page.waitForTimeout(1000);

    // Wait for tee times to render - they might be loaded via JavaScript
    console.log('   Waiting for tee times to render (up to 10 seconds)...');
    try {
      await page
        .waitForSelector('a[data-time], a[href*="time"], button[data-time]', {
          timeout: 10000,
        })
        .catch(() => {
          console.log('   (No standard time selectors found, will search DOM)');
        });
    } catch (e) {
      console.log('   Continuing with DOM search...');
    }

    // Give page extra time to render
    await page.waitForTimeout(2000);

    // Get all available times - find any link or button with time-like text
    console.log('   Finding available tee times...');
    const allLinks = await page.locator('a, button').allTextContents();
    const timeElements = allLinks.filter((text) =>
      /^\d{1,2}:\d{2}/.test(text.trim()),
    );

    console.log(`   Found ${timeElements.length} available times`);

    // Debug: show what we're actually finding
    if (timeElements.length === 0) {
      console.log('   DEBUG: All text content on page:');
      allLinks.slice(0, 20).forEach((t, i) => {
        console.log(`     [${i}] "${t.trim().substring(0, 50)}"`);
      });
    }

    if (timeElements.length === 0) {
      console.error('❌ No tee times found! The tee sheet might be empty.');
      console.log('   Checking page content structure...');

      // Try to find the table or grid structure
      const pageHTML = await page.content();
      const hasTable = pageHTML.includes('<table');
      const hasGrid = pageHTML.includes('grid') || pageHTML.includes('Grid');
      console.log(`   Page has table: ${hasTable}, has grid: ${hasGrid}`);

      await browser.close();
      return;
    }

    const firstAvailableTime = timeElements[0].trim();
    console.log(`   Clicking first available time: ${firstAvailableTime}`);

    // Click first available time
    console.log('8️⃣  Clicking on tee time...');
    const timeLink = page.locator('a', { hasText: firstAvailableTime }).first();
    await timeLink.click({ timeout: 10000 });
    await page.waitForTimeout(1500);

    // Now inspect the booking form
    console.log('9️⃣  Inspecting booking form...');

    // Get page content
    const pageContent = await page.content();

    // Extract the form section
    const formStartIdx = pageContent.indexOf('<form');
    const formEndIdx = pageContent.indexOf('</form>') + 7;

    if (formStartIdx === -1) {
      console.error('❌ No form found on page!');
      console.log('\n📸 Taking screenshot for manual inspection...');
      await page.screenshot({
        path: 'booking-form-screenshot.png',
        fullPage: true,
      });
      console.log('   Screenshot saved: booking-form-screenshot.png');
      await browser.close();
      return;
    }

    const formHTML = pageContent.substring(formStartIdx, formEndIdx);

    // Save form HTML
    const outputDir = './inspection-output';
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }

    fs.writeFileSync(path.join(outputDir, 'booking-form.html'), formHTML);
    console.log(`✅ Form HTML saved to: ${outputDir}/booking-form.html`);

    // Take screenshot
    await page.screenshot({
      path: path.join(outputDir, 'booking-form-screenshot.png'),
      fullPage: true,
    });
    console.log(
      `✅ Screenshot saved to: ${outputDir}/booking-form-screenshot.png`,
    );

    // Parse the form to find player selectors
    console.log('\n🔎 ANALYZING FORM STRUCTURE:');
    console.log('─'.repeat(60));

    // Find all select elements
    const selectPattern = /<select[^>]*>([\s\S]*?)<\/select>/g;
    const selects = [...formHTML.matchAll(selectPattern)];

    console.log(`\n📋 Found ${selects.length} SELECT elements in form:`);

    selects.forEach((match, index) => {
      const selectTag = match[0].substring(0, match[0].indexOf('>') + 1);
      console.log(`\n   SELECT #${index + 1}:`);
      console.log(`   ${selectTag}`);

      // Extract name attribute
      const nameMatch = selectTag.match(/name=["']([^"']+)["']/);
      if (nameMatch) {
        console.log(`   └─ name: "${nameMatch[1]}"`);
      }

      // Extract id attribute
      const idMatch = selectTag.match(/id=["']([^"']+)["']/);
      if (idMatch) {
        console.log(`   └─ id: "${idMatch[1]}"`);
      }

      // Extract class attribute
      const classMatch = selectTag.match(/class=["']([^"']+)["']/);
      if (classMatch) {
        console.log(`   └─ class: "${classMatch[1]}"`);
      }

      // Count options
      const optionsMatch = match[0].match(/<option[^>]*>/g);
      if (optionsMatch) {
        console.log(`   └─ options: ${optionsMatch.length}`);
      }
    });

    // Find all buttons
    console.log('\n\n🔘 BUTTONS IN FORM:');
    const buttonPattern = /<button[^>]*>([\s\S]*?)<\/button>/g;
    const buttons = [...formHTML.matchAll(buttonPattern)];

    buttons.forEach((match, index) => {
      const buttonTag = match[0].substring(0, match[0].indexOf('>') + 1);
      const buttonText = match[1].trim();
      console.log(`\n   BUTTON #${index + 1}:`);
      console.log(`   ${buttonTag}`);
      console.log(`   └─ text: "${buttonText}"`);

      // Extract type
      const typeMatch = buttonTag.match(/type=["']([^"']+)["']/);
      if (typeMatch) {
        console.log(`   └─ type: "${typeMatch[1]}"`);
      }
    });

    // Summary
    console.log('\n\n' + '═'.repeat(60));
    console.log('✅ INSPECTION COMPLETE');
    console.log('═'.repeat(60));

    console.log(`\n📁 Output files saved to: ${outputDir}/`);
    console.log('   • booking-form.html (full form HTML)');
    console.log('   • booking-form-screenshot.png (visual screenshot)');

    console.log('\n📝 NEXT STEPS:');
    console.log('1. Review the HTML file to understand form structure');
    console.log(
      '2. Note the exact "name" or "id" attributes for player selects',
    );
    console.log('3. Identify the confirm/book button text');
    console.log('4. Share findings so we can update the agent code');

    console.log('\n💡 Look for patterns like:');
    console.log('   • <select name="player_2">');
    console.log('   • <select name="player_3">');
    console.log('   • <button>Confirm</button> or <button>Book Now</button>');

    // Keep browser open for 5 more seconds so you can see the form
    console.log('\n⏱️  Keeping browser open for 5 seconds...');
    console.log('   You can manually inspect the form if needed');
    await page.waitForTimeout(5000);
  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.log('\n📍 Troubleshooting:');
    console.log('• Is the username/password correct?');
    console.log('• Is BRS website accessible?');
    console.log('• Are there any tee times available for the selected date?');
  } finally {
    if (browser) {
      await browser.close();
      console.log('\n✅ Browser closed');
    }
  }
}

// Run the inspection
inspectBookingForm().catch(console.error);
