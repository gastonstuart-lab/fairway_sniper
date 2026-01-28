import { chromium } from 'playwright';

const USERNAME = process.env.BRS_USERNAME || '12396024';
const PASSWORD = process.env.BRS_PASSWORD || 'cantona7777';
const CLUB = 'galgorm';

async function run() {
  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();

  const date = process.env.TEE_DATE || '2025-11-28';
  const teeUrl = `https://members.brsgolf.com/${CLUB}/tee-sheet/1/${date.replace(
    /-/g,
    '/',
  )}`;

  try {
    console.log('Navigating to login...');
    await page.goto(`https://members.brsgolf.com/${CLUB}/login`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    const userInput = page
      .locator(
        'input[name="username"], input[name="user"], input[id*="user"], input[placeholder*="username" i]',
      )
      .first();
    await userInput.waitFor({ timeout: 15000 });
    await userInput.fill(USERNAME);
    const passInput = page
      .locator(
        'input[type="password"], input[name="password"], input[id*="pass"], input[placeholder*="password" i]',
      )
      .first();
    await passInput.fill(PASSWORD);
    await page
      .locator(
        'button:has-text("Login"), button:has-text("Log in"), button:has-text("Sign in"), button[type="submit"], input[type="submit"]',
      )
      .first()
      .click();
    await page.waitForTimeout(4000);

    console.log('Opening tee sheet:', teeUrl);
    await page.goto(teeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);

    const rows = page.locator('tr');
    const count = await rows.count();
    console.log(`Found ${count} rows`);

    for (let i = 0; i < count; i++) {
      const row = rows.nth(i);
      const firstCell = row.locator('td, th, [role="gridcell"]').first();
      const timeText = (await firstCell.innerText().catch(() => '')).trim();
      const match = timeText.match(/\b(\d{1,2}:\d{2})\b/);
      if (!match) continue;

      const bookable = await row
        .locator('button, a, [role="button"]')
        .filter({ hasText: /\bbook(\s+now)?\b/i })
        .count();
      if (bookable === 0) continue;

      const cells = await row.locator('td').allInnerTexts();
      const cleaned = cells
        .map((raw, idx) => ({ idx, text: raw.replace(/\s+/g, ' ').trim() }))
        .filter((c) => c.text);
      const html = await row.innerHTML();
      console.log('\n--- Bookable row ---');
      console.log('Time:', match[1]);
      console.log('Cell texts:', cleaned);
      console.log('Row HTML snippet:', html.substring(0, 800));
    }

    console.log('Inspecting first bookable row for dropdowns...');
    const targetRow = rows.filter({ hasText: /BOOK NOW/i }).first();
    const bookBtn = targetRow
      .locator('button, a, [role="button"]')
      .filter({ hasText: /BOOK NOW/i })
      .first();
    await bookBtn.click();
    await page.waitForTimeout(4000);

    const dropdowns = page.locator('select');
    const dropdownCount = await dropdowns.count();
    console.log(`Found ${dropdownCount} select dropdowns on booking page`);

    for (let i = 0; i < dropdownCount; i++) {
      const select = dropdowns.nth(i);
      const name = await select.getAttribute('name');
      const id = await select.getAttribute('id');
      const options = await select.locator('option').allTextContents();
      console.log(`Dropdown ${i + 1}: id=${id} name=${name}`);
      console.log(
        'Options:',
        options
          .map((o) => o.trim())
          .filter(Boolean)
          .slice(0, 20),
      );
    }

    await page.waitForTimeout(30000);
  } catch (err) {
    console.error('Error:', err);
  }

  // Comment out to keep browser open for inspection
  // await browser.close();
}

run();
