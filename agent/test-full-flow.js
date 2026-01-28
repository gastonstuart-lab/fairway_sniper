import { chromium } from 'playwright';

// Full diagnostic test
async function testFullFlow() {
  console.log('🔍 Testing full scraping flow with diagnostics...\n');

  const browser = await chromium.launch({
    headless: false,
    slowMo: 500,
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // LOGIN
    console.log('1️⃣ LOGGING IN...');
    await page.goto('https://members.brsgolf.com/galgorm/login', {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(2000);

    const userInput = page
      .locator(
        'input[name="username"], input[name="user"], input[name="login"], input[placeholder*="username"], input[placeholder*="GUI"], input[placeholder*="ILGU"], input[id*="user"], input[id*="login"]',
      )
      .first();
    await userInput.fill('12390624');

    const passInput = page
      .locator(
        'input[type="password"], input[placeholder*="password"], input[id*="pass"]',
      )
      .first();
    await passInput.fill('cantona7777');

    const submit = page
      .locator(
        'button:has-text("Login"), button:has-text("Sign in"), button:has-text("Log in"), button[type="submit"], input[type="submit"]',
      )
      .first();
    await submit.click();
    await page.waitForTimeout(3000);
    console.log('✅ Login complete\n');

    // NAVIGATE TO TEE SHEET
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const y = tomorrow.getFullYear();
    const m = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const d = String(tomorrow.getDate()).padStart(2, '0');
    const teeUrl = `https://members.brsgolf.com/galgorm/tee-sheet/1/${y}/${m}/${d}`;

    console.log('2️⃣ NAVIGATING TO TEE SHEET:', teeUrl);
    await page.goto(teeUrl);
    await page.waitForTimeout(5000);
    console.log('✅ Navigation complete\n');

    // DIAGNOSTIC: Check for iframe
    console.log('3️⃣ CHECKING FOR IFRAMES...');
    const iframes = await page.locator('iframe').count();
    console.log('Found', iframes, 'iframes');

    if (iframes > 0) {
      for (let i = 0; i < iframes; i++) {
        const src = await page.locator('iframe').nth(i).getAttribute('src');
        console.log(`  Iframe ${i}: ${src}`);
      }
    }
    console.log();

    // DIAGNOSTIC: Find table
    console.log('4️⃣ LOOKING FOR TABLE...');
    const tableCount = await page.locator('table').count();
    console.log('Found', tableCount, 'tables on page');

    if (tableCount === 0) {
      console.log('❌ NO TABLES FOUND - This is the problem!');
      console.log('Page HTML:', await page.content());
      await page.screenshot({
        path: './diagnostic-no-table.png',
        fullPage: true,
      });
      await browser.close();
      return;
    }

    // ANALYZE FIRST TABLE
    console.log('\n5️⃣ ANALYZING FIRST TABLE...');
    const table = page.locator('table').first();

    // Try different row selectors
    console.log('Trying tbody tr...');
    let rows = table.locator('tbody tr');
    let rowCount = await rows.count();
    console.log('  Found', rowCount, 'rows');

    if (rowCount === 0) {
      console.log('Trying just tr...');
      rows = table.locator('tr');
      rowCount = await rows.count();
      console.log('  Found', rowCount, 'rows');
    }

    if (rowCount === 0) {
      console.log('Trying [role="row"]...');
      rows = table.locator('[role="row"]');
      rowCount = await rows.count();
      console.log('  Found', rowCount, 'rows');
    }

    if (rowCount === 0) {
      console.log('\n❌ STILL NO ROWS - Checking table innerHTML...');
      const tableHTML = await table.innerHTML();
      console.log(
        'Table HTML (first 1000 chars):',
        tableHTML.substring(0, 1000),
      );

      console.log('\nTrying to find rows on WHOLE PAGE instead of table...');
      rows = page.locator('tr');
      rowCount = await rows.count();
      console.log('  Found', rowCount, 'tr elements on whole page');
    }

    console.log('\nFinal row count:', rowCount, '\n');

    // CHECK FIRST FEW ROWS
    console.log('6️⃣ CHECKING FIRST 5 ROWS...');
    for (let i = 0; i < Math.min(5, rowCount); i++) {
      const row = rows.nth(i);
      const cells = row.locator('td, th');
      const cellCount = await cells.count();

      console.log(`\nRow ${i + 1}: ${cellCount} cells`);

      for (let j = 0; j < cellCount; j++) {
        const text = await cells
          .nth(j)
          .innerText()
          .catch(() => '');
        console.log(`  Cell ${j + 1}: "${text.trim()}"`);
      }

      // Check for Book button
      const bookBtn = row
        .locator('button, a')
        .filter({ hasText: /\bbook(\s+now)?\b/i });
      const bookCount = await bookBtn.count();
      console.log(`  Book buttons found: ${bookCount}`);

      if (bookCount > 0) {
        const btnText = await bookBtn.first().innerText();
        console.log(`    Button text: "${btnText}"`);
      }
    }

    // FIND ALL BOOKABLE TIMES
    console.log('\n7️⃣ FINDING ALL BOOKABLE TIMES...');
    const foundTimes = [];

    for (let i = 0; i < rowCount; i++) {
      const row = rows.nth(i);
      const firstCell = row.locator('td, th').first();
      const txt = await firstCell.innerText().catch(() => '');

      // Check if first cell contains time
      const timeMatch = txt.trim().match(/\b(\d{1,2}:\d{2})\b/);
      if (timeMatch) {
        const time = timeMatch[1];

        // Check for Book button
        const bookBtn = row
          .locator('button, a')
          .filter({ hasText: /\bbook(\s+now)?\b/i });
        const hasBook = (await bookBtn.count()) > 0;

        if (hasBook) {
          foundTimes.push(time);
          console.log(`✅ Found bookable time: ${time}`);
        } else {
          console.log(`⏭️  Time ${time} has no Book button`);
        }
      }
    }

    console.log('\n📊 RESULTS:');
    console.log('Total bookable times:', foundTimes.length);
    console.log('Times:', foundTimes.join(', '));

    if (foundTimes.length === 0) {
      console.log('\n❌ FOUND 0 TIMES - Taking screenshot for analysis...');
      await page.screenshot({
        path: './diagnostic-zero-times.png',
        fullPage: true,
      });
    }

    // Keep browser open
    console.log('\n⏳ Keeping browser open for 30 seconds for inspection...');
    await page.waitForTimeout(30000);
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await browser.close();
    console.log('✅ Test complete');
  }
}

testFullFlow().catch(console.error);
