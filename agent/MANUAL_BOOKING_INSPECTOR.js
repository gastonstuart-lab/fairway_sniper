import { chromium } from '@playwright/test';
import 'dotenv/config';

(async () => {
  console.log('\n🔍 MANUAL BOOKING INSPECTOR');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('This will open a browser and pause for you to click through.');
  console.log('I will inspect the HTML after each step you take.\n');

  const browser = await chromium.launch({ 
    headless: false,
    slowMo: 500 
  });
  const page = await browser.newPage();
  
  // Step 1: Login
  console.log('📍 Step 1: Logging in...');
  await page.goto('https://members.brsgolf.com/galgorm/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  
  const currentUrl = page.url();
  console.log(`Current URL: ${currentUrl}`);
  
  if (currentUrl.includes('/login')) {
    console.log('Filling login form...');
    await page.waitForSelector('#username', { timeout: 5000 });
    await page.fill('#username', '12390624');
    await page.fill('#password', 'cantora7777');
    await page.click('button[type="submit"]');
    await page.waitForURL(url => !url.includes('/login'), { timeout: 10000 });
    console.log('✅ Logged in');
  } else {
    console.log('✅ Already logged in');
  }
  await page.waitForTimeout(2000);
  
  // Step 2: Go to tee sheet for Jan 29
  console.log('📍 Step 2: Going to tee sheet for Jan 29...');
  await page.goto('https://members.brsgolf.com/galgorm/tee-sheet/1/2026/01/29');
  await page.waitForTimeout(3000);
  console.log('✅ Tee sheet loaded\n');
  
  // Step 3: PAUSE - let user click "BOOK NOW"
  console.log('⏸️  PAUSED - Now YOU do the following:');
  console.log('   1. Find a tee time with availability (e.g., 13:30)');
  console.log('   2. Click "BOOK NOW"');
  console.log('   3. Press Resume in the Playwright Inspector');
  console.log('');
  
  await page.pause();
  
  // Step 4: Inspect booking form
  console.log('\n🔍 INSPECTING BOOKING FORM...\n');
  
  // Check what's on the page now
  const pageContent = await page.content();
  const hasTimer = pageContent.includes('minutes') && pageContent.includes('seconds');
  console.log(`⏰ Timer visible: ${hasTimer}`);
  
  // Check for player dropdowns
  const playerInputs = await page.locator('select[name*="player"], input[name*="player"]').count();
  console.log(`👥 Player inputs found: ${playerInputs}`);
  
  // Check for Select2
  const select2Containers = await page.locator('.select2-container').count();
  console.log(`📋 Select2 dropdowns: ${select2Containers}`);
  
  // Find all buttons
  const buttons = await page.locator('button').evaluateAll(btns => 
    btns.map(b => ({ text: b.textContent?.trim(), id: b.id, class: b.className }))
  );
  console.log('\n🔘 All buttons on page:');
  buttons.forEach((btn, i) => {
    if (btn.text) console.log(`   ${i + 1}. "${btn.text}" (id: ${btn.id || 'none'})`);
  });
  
  // Check for player fields specifically
  console.log('\n👤 Player field details:');
  for (let i = 1; i <= 4; i++) {
    const select = await page.locator(`select[name="member_booking_form[player_${i}]"]`).count();
    const container = await page.locator(`.select2-container:has(select[name="member_booking_form[player_${i}]"])`).count();
    console.log(`   Player ${i}: select=${select}, select2=${container}`);
  }
  
  console.log('\n⏸️  PAUSED AGAIN - Now YOU do:');
  console.log('   1. Fill in the players manually (or let me try)');
  console.log('   2. Look for the submit button');
  console.log('   3. Press Resume when ready');
  console.log('');
  
  await page.pause();
  
  // Step 5: Check for submit button
  console.log('\n🔍 LOOKING FOR SUBMIT BUTTON...\n');
  
  const allButtons = await page.locator('button').evaluateAll(btns => 
    btns.map(b => ({
      text: b.textContent?.trim(),
      type: b.type,
      id: b.id,
      visible: b.offsetParent !== null,
      enabled: !b.disabled
    }))
  );
  
  console.log('🔘 All buttons (with state):');
  allButtons.forEach((btn, i) => {
    console.log(`   ${i + 1}. "${btn.text}" | type=${btn.type} | visible=${btn.visible} | enabled=${btn.enabled}`);
  });
  
  console.log('\n⏸️  FINAL PAUSE - Click submit if you want to test, or just close browser');
  console.log('');
  
  await page.pause();
  
  console.log('\n✅ Inspection complete!');
  await browser.close();
})();
