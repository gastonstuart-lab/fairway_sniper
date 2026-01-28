#!/usr/bin/env node
/**
 * Booking Logic Module
 * Ported from proven automation tests (automation/tests/book_slot.spec.ts)
 * Handles tee sheet navigation, slot detection, and booking
 */

/**
 * Ensure user is logged in; if on login page, perform auto-login
 */
export async function ensureLoggedIn(page, username, password, logger) {
  if (!/\/login\b/i.test(page.url())) {
    logger?.debug('Already logged in (not on login page)');
    return;
  }

  logger?.info('Detected login page - performing auto-login');
  const userInput = page.getByPlaceholder(/8 digit GUI|ILGU|username/i).first();
  const passInput = page.getByPlaceholder(/password/i).first();

  await userInput.waitFor({ state: 'visible', timeout: 8000 });
  await userInput.fill(username);
  await passInput.fill(password);

  const loginBtn = page.getByRole('button', { name: /login/i }).first();
  await loginBtn.click();

  // Wait for logged-in signal
  const loggedInSignal = page
    .getByRole('link', { name: /tee sheet/i })
    .first()
    .or(page.getByRole('button', { name: /book a tee time/i }).first());

  await loggedInSignal.waitFor({ state: 'visible', timeout: 15000 });
  logger?.info('✅ Auto-login complete');
}

/**
 * Navigate to tee sheet page for a specific date
 */
export async function gotoTeeDate(page, courseId, isoDate, logger) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const url = `https://members.brsgolf.com/galgorm/tee-sheet/${courseId}/${String(y).padStart(4, '0')}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`;
  
  logger?.info('Navigating to tee sheet:', url);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
  
  // Brief delay for JavaScript to render
  await page.waitForTimeout(2000);
}

/**
 * Find the root for tee sheet (iframe or page)
 * Returns frameLocator if iframe found with times, otherwise page
 */
export async function rootForTee(page, logger) {
  const candidates = [
    'iframe[src*="tee"]',
    'iframe[id*="tee"]',
    'iframe[src*="sheet"]',
    'iframe',
  ];
  const timePattern = 'text=/\\b(?:0?\\d|1\\d|2[0-3]):[0-5]\\d\\b/';

  for (const sel of candidates) {
    try {
      const count = await page.locator(sel).count();
      if (count === 0) continue;

      const fl = page.frameLocator(sel);
      const hasTime = await fl.locator(timePattern).first().count().catch(() => 0);
      if (hasTime > 0) {
        logger?.debug('Using frameLocator for selector:', sel);
        return fl;
      }
    } catch (e) {
      // ignore
    }
  }

  logger?.debug('No iframe root found; using page root');
  return page;
}

/**
 * Wait for tee sheet to be ready
 */
export async function waitForTeeSheet(page, logger) {
  logger?.info('Waiting for tee sheet...');
  
  // Accept cookies if present
  const cookie = page
    .locator('button:has-text("Accept"), button:has-text("I Agree")')
    .first();
  if (await cookie.isVisible().catch(() => false)) {
    await cookie.click().catch(() => {});
    logger?.debug('Cookie banner dismissed');
  }

  // Wait for any of these signals
  const dateHeader = page.locator('button', {
    hasText: /JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC/i,
  }).first();
  
  const anyTime = page.locator('text=/\\b(?:0?\\d|1\\d|2[0-3]):[0-5]\\d\\b/').first();
  
  const anyAction = page.locator(
    'button:has-text("Book"), button:has-text("Waiting"), a:has-text("Book"), [role="button"]:has-text("Book")'
  ).first();

  const startMs = Date.now();
  const timeoutMs = 30000;
  
  while (Date.now() - startMs < timeoutMs) {
    if (await dateHeader.isVisible().catch(() => false)) {
      logger?.info('✅ Date header visible');
      return;
    }
    if (await anyTime.isVisible().catch(() => false)) {
      logger?.info('✅ Tee time visible');
      return;
    }
    if (await anyAction.isVisible().catch(() => false)) {
      logger?.info('✅ Booking action visible');
      return;
    }
    await page.waitForTimeout(300);
  }

  throw new Error('Tee sheet not detected within 30s');
}

/**
 * Scan a date for actionable slots (Book or Waitlist)
 * Returns first available time >= preferred, or first available overall
 */
export async function scanCurrentDateForActionable(
  root,
  preferredTimes,
  clickWaitlist = false,
  logger
) {
  const timeRegex = /\b(?:0?\d|1\d|2[0-3]):[0-5]\d\b/;
  
  // Try table-based layout first
  const table = root.locator('table:has(tr), [role="grid"]:has(tr)').first();
  let rows;
  
  if (await table.isVisible().catch(() => false)) {
    rows = table.locator('tbody tr, tr');
  } else {
    // Fallback to div-based layout
    rows = root.locator(
      '.tee-row, .slot-row, .timeslot, .slot, .availability, tr'
    );
  }

  const count = await rows.count();
  if (count === 0) {
    logger?.warn('No rows found on tee sheet');
    return { found: false };
  }

  const results = [];

  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const txt = (await row.innerText().catch(() => '')) || '';
    const times = txt.match(new RegExp(timeRegex, 'g')) || [];
    const time = times[0]?.trim();

    if (!time) continue;

    const bookBtn = row
      .locator(':is(button,a,[role="button"],.btn):has-text(/\\bbook\\b/i)')
      .first();
    const waitBtn = row
      .locator(':is(button,a,[role="button"],.btn):has-text(/waiting( list)?/i)')
      .first();

    const canBook = await bookBtn.isVisible().catch(() => false);
    const canWait = await waitBtn.isVisible().catch(() => false);

    if (canBook || (clickWaitlist && canWait)) {
      results.push({ time, canBook, canWait, row, bookBtn, waitBtn });
    }
  }

  if (results.length === 0) {
    logger?.warn('No actionable slots found');
    return { found: false };
  }

  logger?.info(
    'Found slots:',
    results.map(r => `${r.time} (${r.canBook ? 'Book' : 'Waiting'})`).join(', ')
  );

  // Convert time string to minutes
  const toMins = (t) => {
    const [h = '0', m = '0'] = t.split(':');
    return Number(h) * 60 + Number(m);
  };

  // Find first result >= preferred time
  for (const pref of preferredTimes.filter(Boolean)) {
    const prefMins = toMins(pref);
    const candidate = results
      .sort((a, b) => toMins(a.time) - toMins(b.time))
      .find(r => toMins(r.time) >= prefMins);

    if (candidate) {
      logger?.info(`✅ Selected ${candidate.time} (>= preferred ${pref})`);
      return { found: true, chosen: candidate };
    }
  }

  // Fallback: first available
  const first = results.sort((a, b) => toMins(a.time) - toMins(b.time))[0];
  logger?.info(`✅ Selected ${first.time} (first available)`);
  return { found: true, chosen: first };
}

/**
 * Get all visible times from root element
 */
export async function getVisibleTimes(root) {
  const texts = await root
    .locator('text=/\\b(?:0?\\d|1\\d|2[0-3]):[0-5]\\d\\b/')
    .allTextContents();

  const set = new Set();
  for (const txtRaw of texts) {
    const txt = (txtRaw ?? '').trim();
    const m = txt.match(/(\d{1,2}:\d{2})/);
    if (m && m[1]) {
      set.add(m[1].padStart(5, '0'));
    }
  }

  return Array.from(set).sort((a, b) => {
    const [ahStr = '0', amStr = '0'] = a.split(':');
    const [bhStr = '0', bmStr = '0'] = b.split(':');
    const ah = parseInt(ahStr, 10) || 0;
    const am = parseInt(amStr, 10) || 0;
    const bh = parseInt(bhStr, 10) || 0;
    const bm = parseInt(bmStr, 10) || 0;
    return ah * 60 + am - (bh * 60 + bm);
  });
}

/**
 * Click Book or Waitlist button with retries
 */
export async function performBookingAction(button, actionType, logger) {
  logger?.info(`Attempting to click ${actionType}...`);
  
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await button.scrollIntoViewIfNeeded();
      await button.click({ timeout: 2000 });
      logger?.info(`✅ ${actionType} clicked successfully`);
      return true;
    } catch (e) {
      logger?.warn(`Attempt ${attempt + 1} failed:`, e.message);
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  return false;
}

/**
 * Wait for booking confirmation
 */
export async function waitForBookingConfirmation(page, logger) {
  const success = page.locator(
    'text=/Booking|Booked|Confirmed|Confirmation|Waiting list|Added to waiting list/i'
  ).first();

  try {
    await success.waitFor({ state: 'visible', timeout: 12000 });
    logger?.info('🎉 Booking confirmation detected');
    return true;
  } catch (e) {
    logger?.error('Booking confirmation not found:', e.message);
    return false;
  }
}

export default {
  ensureLoggedIn,
  gotoTeeDate,
  rootForTee,
  waitForTeeSheet,
  scanCurrentDateForActionable,
  getVisibleTimes,
  performBookingAction,
  waitForBookingConfirmation,
};
