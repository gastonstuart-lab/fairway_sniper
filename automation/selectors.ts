import { Page, Locator, FrameLocator } from '@playwright/test';

export interface FindActionResult {
  row?: Locator;
  bookBtn: Locator | null;
  waitBtn: Locator | null;
}

/**
 * Wait for page to load with domcontentloaded + UI signals
 * SPA-safe: doesn't depend on networkidle event
 */
export async function waitForPageLoad(
  page: Page,
  timeout = 12000,
): Promise<void> {
  try {
    await page.waitForLoadState('domcontentloaded', { timeout: 5000 });
  } catch (e) {
    console.log('  ⚠️ DOM timeout');
  }

  // Poll for real UI signals
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    const hasButton = await page
      .locator(':is(button,a,[role="button"])')
      .first()
      .isVisible()
      .catch(() => false);

    const hasText = await page
      .locator('text=/[a-zA-Z]/') // any letter
      .first()
      .isVisible()
      .catch(() => false);

    if (hasButton && hasText) {
      console.log('  ✓ Page ready');
      return;
    }

    await page.waitForTimeout(200);
  }

  console.log('  ⚠️ Timeout waiting for UI signals');
}

/**
 * Navigate to URL using page.goto with domcontentloaded only
 * SPA-safe: avoids networkidle which can hang on dynamic apps
 */
export async function navigateTo(
  page: Page,
  url: string,
  timeout = 12000,
): Promise<void> {
  console.log(`  🔗 Navigating to: ${url}`);
  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout,
    });
    console.log(`  ✓ Page loaded`);
  } catch (e) {
    console.log(`  ⚠️ Navigation timeout: ${e.message}`);
  }
  await waitForPageLoad(page, 8000);
}

/**
 * Click an element and wait for URL navigation
 * For SPA navigation: waits for URL change, not generic navigation event
 */
export async function clickAndWaitForNavigation(
  page: Page,
  element: Locator,
  urlPattern: string,
  timeout = 15000,
): Promise<void> {
  const urlPromise = page.waitForURL(urlPattern, { timeout });
  await element.click();
  await urlPromise;
  await waitForPageLoad(page, 5000);
}

/**
 * Navigate to tee sheet using direct URL
 * Format: courseId and date are parameters
 */
export async function navigateToTeeSheet(
  page: Page,
  courseId: string,
  date: Date,
  clubUrl: string = 'https://members.brsgolf.com/galgorm',
): Promise<void> {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const dateStr = `${year}/${month}/${day}`;
  const url = `${clubUrl}/tee-sheet/${courseId}/${dateStr}`;

  console.log(`  📅 Tee sheet: ${url}`);
  await navigateTo(page, url);
}

/**
 * Ensure we're logged in
 * SPA-optimized: uses URL waits instead of element waits
 */
export async function ensureLoggedIn(
  page: Page,
  username: string,
  password: string,
): Promise<void> {
  const url = page.url();

  if (url.includes('/tee-sheet')) {
    console.log('  ✅ Already on tee sheet');
    return;
  }

  if (url.includes('/login')) {
    console.log('  🔐 On login page...');

    const userInput = page
      .getByPlaceholder(/username|8 digit|email|gui/i)
      .first();
    if (await userInput.isVisible().catch(() => false)) {
      await userInput.clear();
      await userInput.fill(username, { delay: 50 });
    }

    const passInput = page
      .getByPlaceholder(/password/i)
      .first();
    if (await passInput.isVisible().catch(() => false)) {
      await passInput.clear();
      await passInput.fill(password, { delay: 50 });
    }

    const loginBtn = page
      .getByRole('button', { name: /login/i })
      .first();
    await loginBtn.click();

    console.log('  ⏳ Waiting for login redirect...');
    try {
      await page.waitForURL('**/galgorm/**', { timeout: 15000 });
      console.log(`  ✓ Logged in`);
    } catch (e) {
      console.log(`  ⚠️ URL timeout`);
    }

    await waitForPageLoad(page, 5000);

    // Save cookies
    await page.context().storageState({ path: 'state.json' });
  }
}

/**
 * Get the root element for tee sheet content (page or iframe)
 * BRS may use iframes to wrap tee sheet UI
 */
export async function getRootForTee(
  page: Page,
): Promise<Page | FrameLocator> {
  const candidates = [
    'iframe[src*="tee"]',
    'iframe[id*="tee"]',
    'iframe[src*="sheet"]',
    'iframe',
  ];

  for (const sel of candidates) {
    try {
      const count = await page.locator(sel).count();
      if (count === 0) continue;

      const fl = page.frameLocator(sel);
      const texts = await fl
        .locator('text=/\\d{1,2}:\\d{2}/')
        .allTextContents()
        .catch(() => []);

      if (texts.length > 0) {
        console.log(`  ℹ️ Using iframe root: ${sel}`);
        return fl;
      }
    } catch (e) {
      // ignore, try next
    }
  }

  console.log(`  ℹ️ No iframe found, using page root`);
  return page;
}

/**
 * Scan tee sheet for ALL bookable times (sniper mode)
 * Returns first available slot matching preferred times, or first available overall
 */
export async function scanForBookableTimes(
  root: Page | FrameLocator,
  preferredTimes: string[],
): Promise<{ time: string; action: FindActionResult } | null> {
  console.log('🔍 Scanning for bookable tee times...');

  // Try table rows first
  let rows = root.locator('tr');
  let rowCount = await rows.count().catch(() => 0);

  console.log(`  📋 Found ${rowCount} <tr> elements`);

  if (rowCount === 0) {
    rows = root.locator(
      '.tee-row, .slot-row, .timeslot, .slot, .availability, [role="row"]',
    );
    rowCount = await rows.count().catch(() => 0);
    console.log(`  📋 Found ${rowCount} div-based rows`);
  }

  if (rowCount === 0) {
    console.log('❌ No rows found on tee sheet');
    return null;
  }

  const availableSlots: Array<{ time: string; row: Locator; bookBtn: Locator | null; waitBtn: Locator | null }> = [];

  // Scan ALL rows for bookable times
  for (let i = 0; i < rowCount; i++) {
    const row = rows.nth(i);
    const txt = await row.innerText().catch(() => '');

    if (i < 3) {
      console.log(`  🔎 Row ${i}: "${txt.substring(0, 100)}..."`);
    }

    // Extract time from row text (HH:MM format)
    const timeMatch = txt.match(/\b(\d{1,2}:\d{2})\b/);
    if (!timeMatch) continue;

    const time = timeMatch[1];

    // Check for Book button
    const bookBtn = row
      .locator(':is(button,a,[role="button"])')
      .filter({ hasText: /\bbook(\s+now)?\b/i })
      .first();

    const waitBtn = row
      .locator(':is(button,a,[role="button"])')
      .filter({ hasText: /waiting(\s+list)?\b/i })
      .first();

    const canBook = (await bookBtn.count()) > 0;
    const canWait = (await waitBtn.count()) > 0;

    if (canBook || canWait) {
      availableSlots.push({ time, row, bookBtn: canBook ? bookBtn : null, waitBtn: canWait ? waitBtn : null });
    }
  }

  if (availableSlots.length === 0) {
    console.log('❌ No bookable slots found');
    return null;
  }

  console.log(`  📋 Found ${availableSlots.length} bookable slots:`, availableSlots.map(s => s.time).join(', '));

  // Try preferred times first
  for (const pref of preferredTimes) {
    const match = availableSlots.find(s => s.time === pref || s.time.startsWith(pref));
    if (match) {
      console.log(`✅ Selected preferred time: ${match.time}`);
      return { time: match.time, action: { row: match.row, bookBtn: match.bookBtn, waitBtn: match.waitBtn } };
    }
  }

  // Fallback: first available
  const first = availableSlots[0];
  console.log(`✅ Selected first available: ${first.time}`);
  return { time: first.time, action: { row: first.row, bookBtn: first.bookBtn, waitBtn: first.waitBtn } };
}

/**
 * Legacy function for compatibility
 */
export async function findTeeTimeAction(
  root: Page | FrameLocator,
  timeStr: string,
): Promise<FindActionResult | null> {
  const result = await scanForBookableTimes(root, [timeStr]);
  return result?.action || null;
}

/**
 * Click a booking button with retry logic
 */
export async function clickBooking(
  page: Page,
  btn: Locator,
  maxRetries = 3,
): Promise<boolean> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`📌 Clicking booking button (attempt ${attempt})...`);
      await btn.scrollIntoViewIfNeeded();
      await btn.click({ delay: 100 });
      return true;
    } catch (e) {
      if (attempt < maxRetries) {
        console.log(`  Retry ${attempt}/${maxRetries}...`);
        await page.waitForTimeout(300);
      } else {
        console.log(`  Failed after ${maxRetries} attempts`);
        return false;
      }
    }
  }
  return false;
}

/**
 * Open the date picker calendar
 */
export async function openCalendar(page: Page): Promise<void> {
  console.log('📅 Opening calendar...');

  const dateBtn = page
    .locator('button:has-text(/JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC/i)')
    .first();

  if (await dateBtn.isVisible().catch(() => false)) {
    await dateBtn.click();
    await page.waitForTimeout(500);
    console.log('  ✓ Calendar opened');
  } else {
    console.log('  ⚠️ Calendar button not found');
  }
}

/**
 * Select a specific day in the calendar
 */
export async function selectCalendarDay(
  page: Page,
  day: number,
  maxAttempts = 2,
): Promise<void> {
  console.log(`📅 Selecting day ${day}...`);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Look for day button in calendar
    const dayBtn = page
      .locator(
        `button:has-text("${day}"), [role="button"]:has-text("${day}"), td:has-text("${day}") button, td:has-text("${day}") a`,
      )
      .first();

    if (await dayBtn.isVisible().catch(() => false)) {
      await dayBtn.click();
      await page.waitForTimeout(300);
      console.log(`  ✓ Day ${day} selected`);
      return;
    }

    if (attempt === 0) {
      // Try opening calendar again
      await openCalendar(page);
    }
  }

  console.log(`  ⚠️ Could not select day ${day}`);
}

/**
 * Check if we're on the target date already
 */
export async function isOnTargetDate(
  page: Page,
  targetDate: Date,
): Promise<boolean> {
  const dateHeader = page
    .locator('button:has-text(/JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC/i)')
    .first();

  if (await dateHeader.isVisible().catch(() => false)) {
    const headerText = await dateHeader.innerText().catch(() => '');
    const isTarget = headerText.includes(String(targetDate.getDate()));
    console.log(
      `  ${isTarget ? '✅' : '❌'} Current date: ${headerText}, target: day ${targetDate.getDate()}`,
    );
    return isTarget;
  }

  return false;
}

/**
 * Fill players 2-4 automatically (Player 1 is implicit logged-in user)
 */
export async function fillPlayers(
  page: Page | FrameLocator,
  players: string[],
): Promise<void> {
  console.log('👥 Filling players 2-4...');

  for (let i = 0; i < players.length && i < 3; i++) {
    const playerName = players[i];
    const playerNum = i + 2; // Player 2, 3, 4

    const input = page
      .getByPlaceholder(new RegExp(`player\\s*${playerNum}|name\\s*${playerNum}`, 'i'))
      .first()
      .or(page.locator(`input[name*="player${playerNum}"], input[id*="player${playerNum}"]`).first());

    if (await input.isVisible().catch(() => false)) {
      await input.fill(playerName);
      console.log(`  ✓ Player ${playerNum}: ${playerName}`);
    } else {
      console.log(`  ⚠️ Player ${playerNum} input not found`);
    }
  }
}

/**
 * Auto-confirm booking (clicks Confirm/Book button)
 */
export async function autoConfirm(
  page: Page | FrameLocator,
): Promise<boolean> {
  console.log('🎯 Auto-confirming booking...');

  const confirmBtn = page
    .getByRole('button', { name: /confirm|book now|complete|finalize/i })
    .first()
    .or(page.locator('button:has-text("Confirm"), button:has-text("Book")').first());

  if (await confirmBtn.isVisible().catch(() => false)) {
    await confirmBtn.click();
    console.log('  ✅ Confirm clicked');
    return true;
  }

  console.log('  ⚠️ Confirm button not found');
  return false;
}
