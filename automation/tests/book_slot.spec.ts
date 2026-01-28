import 'dotenv/config';
import { test, expect } from '@playwright/test';

// Async loader for date-fns-tz to handle ESM/CJS differences at runtime
async function getZonedTimeToUtc() {
  try {
    const mod = await import('date-fns-tz');
    return (
      (mod as any).zonedTimeToUtc ??
      (mod as any).default?.zonedTimeToUtc ??
      (mod as any)
    );
  } catch (e) {
    // Fallback to require via createRequire for older environments
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createRequire } = await import('module');
    const req = createRequire(import.meta.url);
    const _df = req('date-fns-tz');
    return _df.zonedTimeToUtc ?? _df.default?.zonedTimeToUtc ?? _df;
  }
}

// Use authenticated state saved previously
test.use({ storageState: 'state.json' });

// Helper: parse environment variables with defaults
const env: {
  DRY_RUN: boolean;
  RAW_TARGET_DATE: string;
  TARGET_DAY: string | undefined; // day number as string (e.g. '25')
  TARGET_TIMES: string[];
  CLICK_WAITLIST: boolean;
} = {
  DRY_RUN: (process.env.FS_DRY_RUN ?? 'true').toLowerCase() === 'true',
  RAW_TARGET_DATE: (process.env.FS_TARGET_DATE ?? '').trim(),
  TARGET_DAY: undefined,
  TARGET_TIMES: (process.env.FS_TARGET_TIMES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  CLICK_WAITLIST:
    (process.env.FS_CLICK_WAITLIST ?? 'false').toLowerCase() === 'true',
};

// How many days ahead to scan when current date has no actionable slots
const SEARCH_DAYS = Number(process.env.FS_SEARCH_DAYS ?? '14');

// Timezone-aware release configuration
// .env values:
// FS_RELEASE_AT_LOCAL=2025-10-25T07:00:00  (local clock in the target timezone)
// FS_TZ=Europe/London
const TZ = process.env.FS_TZ || 'Europe/London';
const RELEASE_AT_LOCAL = process.env.FS_RELEASE_AT_LOCAL || '';
// Will be computed at runtime inside the test to avoid module loading issues
let RELEASE_AT: Date | null = null;

// Interpret RAW_TARGET_DATE: accept YYYY-MM-DD or just day number like '25'
if (env.RAW_TARGET_DATE) {
  const isoMatch = env.RAW_TARGET_DATE.match(/^\d{4}-\d{2}-\d{2}$/);
  if (isoMatch) {
    const d = new Date(env.RAW_TARGET_DATE);
    if (!Number.isNaN(d.getTime())) {
      env.TARGET_DAY = String(d.getDate());
    } else {
      // fallback to last number group
      const m = env.RAW_TARGET_DATE.match(/(\d{1,2})$/);
      env.TARGET_DAY = m ? String(Number(m[1])) : undefined;
    }
  } else {
    const m = env.RAW_TARGET_DATE.match(/^(\d{1,2})$/);
    env.TARGET_DAY = m ? String(Number(m[1])) : undefined;
  }
}
// Helper: open the calendar robustly
async function openCalendar(page: import('@playwright/test').Page) {
  const dateBtn = page
    .locator('button', {
      hasText: /JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC/i,
    })
    .first();
  await dateBtn.waitFor({ state: 'visible', timeout: 7000 });
  await dateBtn.click();

  // Wait for any known calendar overlay/panel to appear. Different sites use
  // different datepicker implementations, so try a few selectors.
  const calendarSelectors = [
    '.mat-calendar',
    '.mat-datepicker-content',
    '.mat-datepicker-popup',
    '.cdk-overlay-container .mat-calendar',
    '.ui-datepicker',
    '.datepicker',
    '[role="dialog"]',
  ];

  const start = Date.now();
  const timeout = 9000;
  while (Date.now() - start < timeout) {
    for (const sel of calendarSelectors) {
      if (
        await page
          .locator(sel)
          .first()
          .isVisible()
          .catch(() => false)
      ) {
        console.log('📅 Calendar opened via selector', sel);
        return;
      }
    }

    // Fallback: sometimes the calendar is rendered inline without a wrapper
    // but day cells/buttons appear. Detect any day-like button or cell.
    const dayLike = page
      .locator(
        'button:has-text("1"), button:has-text("2"), button:has-text("3"), .mat-calendar-body-cell, .ui-datepicker-day',
      )
      .first();
    if (await dayLike.isVisible().catch(() => false)) {
      console.log('📅 Calendar-like day cell visible');
      return;
    }

    await page.waitForTimeout(200);
  }

  // If we didn't detect a calendar, surface a helpful message for debugging.
  throw new Error(
    'Calendar did not appear after clicking date button (checked several selectors)',
  );
}

// Helper: try to select a calendar day, hopping months up to maxHops
async function selectCalendarDay(
  page: import('@playwright/test').Page,
  day: string,
  maxHops = 12,
) {
  // Try current and up to maxHops next months
  for (let i = 0; i <= maxHops; i++) {
    // Try a bunch of selectors for enabled day cells/buttons across implementations
    const daySelectors = [
      `.mat-calendar-body-cell:not(.mat-calendar-body-disabled) .mat-calendar-body-cell-content:text-is("${day}")`,
      `.mat-calendar-body-cell-content:text-is("${day}")`,
      `button:has-text("${day}")`,
      `.ui-datepicker-calendar td:not(.ui-datepicker-unselectable) :text-is("${day}")`,
      `.datepicker td:not(.disabled) :text-is("${day}")`,
      `text("${day}")`,
    ];

    for (const sel of daySelectors) {
      const enabledDay = page.locator(sel).first();
      if (await enabledDay.isVisible().catch(() => false)) {
        console.log(
          `📅 Clicking day ${day} on month hop ${i} using selector ${sel}`,
        );
        await enabledDay.click().catch(() => {});
        return true;
      }
    }

    // Go to next month and retry
    const nextBtn = page
      .locator(
        '.mat-calendar-next-button, button[aria-label="Next month"], button.mat-calendar-next-button',
      )
      .first();
    if (await nextBtn.isVisible().catch(() => false)) {
      await nextBtn.click();
      await page.waitForTimeout(250);
    } else {
      break;
    }
  }
  return false;
}

// Helper: ensure the page is logged in, perform auto-login fallback and refresh state.json
async function ensureLoggedIn(page: import('@playwright/test').Page) {
  // If already past login, return
  if (!/\/login\b/i.test(page.url())) return;

  const USER = process.env.FS_USERNAME ?? process.env.FS_EMAIL ?? '';
  const PASS = process.env.FS_PASSWORD ?? '';

  // Fill by placeholders to be resilient
  const userInput = page.getByPlaceholder(/8 digit GUI|ILGU|username/i).first();
  const passInput = page.getByPlaceholder(/password/i).first();
  await userInput.waitFor({ state: 'visible', timeout: 8000 });
  await userInput.fill(USER);
  await passInput.fill(PASS);

  await page.getByRole('button', { name: /login/i }).first().click();

  // Wait for a logged-in signal: left nav or Book a Tee Time button
  const loggedInSignal = page
    .getByRole('link', { name: /tee sheet/i })
    .first()
    .or(page.getByRole('button', { name: /book a tee time/i }).first());
  await loggedInSignal.waitFor({ state: 'visible', timeout: 15000 });

  // Persist refreshed cookies for future runs
  await page.context().storageState({ path: 'state.json' });
  console.log('🔐 Auto-login complete, state.json refreshed');
}

// Returns a Locator root that points either to the tee iframe’s document, or the page if no iframe.
async function rootForTee(page: import('@playwright/test').Page) {
  const candidates = [
    'iframe[src*="tee"]',
    'iframe[id*="tee"]',
    'iframe[src*="sheet"]',
    'iframe', // fallback
  ];
  const timePattern = 'text=/\\b(?:0?\\d|1\\d|2[0-3]):[0-5]\\d\\b/';
  for (const sel of candidates) {
    try {
      const count = await page.locator(sel).count();
      if (count === 0) continue;
      const fl = page.frameLocator(sel);
      const hasTime = await fl
        .locator(timePattern)
        .first()
        .count()
        .catch(() => 0);
      if (hasTime > 0) {
        console.log('🔎 Using frameLocator for selector', sel);
        return fl;
      }
    } catch (e) {
      // ignore and try next selector
    }
  }
  return page;
}

// Finds the row for a given time string by locating a TD that matches the time and then its sibling action cell.
async function findRowAndAction(root: any, time: string) {
  // time cell: exact text match like 07:56 (trim whitespace)
  const timeCell = root
    .locator(`td:has-text("${time}")`)
    .first()
    .or(root.locator(`.tee-time:has-text("${time}")`).first());
  await timeCell.waitFor({ state: 'visible', timeout: 12000 });

  // Row is the ancestor tr (or a div row as fallback)
  const row = timeCell
    .locator(
      'xpath=ancestor::tr | ancestor::div[contains(@class,"row") or contains(@class,"tee")]',
    )
    .first();

  // Action cell/buttons within the same row
  const bookBtn = row
    .locator(
      'button:has-text("Book"), a:has-text("Book"), [role="button"]:has-text("Book")',
    )
    .first();
  const waitBtn = row
    .locator(
      'button:has-text("Waiting"), button:has-text("Waiting List"), a:has-text("Waiting")',
    )
    .first();

  return { row, bookBtn, waitBtn };
}

// Table-aware fallback: scan table rows and find a matching time cell and its action cell
async function findRowAndActionTable(root: any, time: string) {
  // Find a tee table/grid
  const table = root.locator('table:has(tr), [role="grid"]:has(tr)').first();
  await table.waitFor({ state: 'visible', timeout: 8000 });

  const rows = table.locator('tbody tr, tr');
  const count = await rows.count();
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const cells = row.locator('td, [role="gridcell"]');
    const firstCell = cells.first();
    const t = (await firstCell.innerText().catch(() => '')).trim();

    if (t === time) {
      // Typical action cell is not the first one
      const actionCell = cells.nth(1).or(cells.nth(2)).or(row); // fallback to row
      const bookBtn = actionCell
        .locator(
          'button:has-text(/\\bbook\\b/i), a:has-text(/\\bbook\\b/i), [role="button"]:has-text(/\\bbook\\b/i)',
        )
        .first();
      const waitBtn = actionCell
        .locator(
          'button:has-text(/waiting( list)?/i), a:has-text(/waiting( list)?/i), [role="button"]:has-text(/waiting( list)?/i)',
        )
        .first();
      return { row, bookBtn, waitBtn };
    }
  }
  return {
    row: rows.first(),
    bookBtn: root.locator('_no_match_'),
    waitBtn: root.locator('_no_match_'),
  };
}

test('book first available preferred tee time (safe)', async ({ page }) => {
  test.setTimeout(180_000);

  console.log('⚙️ Config...', {
    dryRun: env.DRY_RUN,
    rawTargetDate: env.RAW_TARGET_DATE,
    targetDay: env.TARGET_DAY ?? null,
    targetTimes: env.TARGET_TIMES,
    searchDays: SEARCH_DAYS,
    tz: process.env.FS_TZ || 'Europe/London',
    releaseAtLocal: process.env.FS_RELEASE_AT_LOCAL || null,
    clickWaitlist: env.CLICK_WAITLIST,
  });

  // Compute RELEASE_AT at runtime using dynamic loader
  if (RELEASE_AT_LOCAL) {
    const _z = await getZonedTimeToUtc();
    try {
      RELEASE_AT = _z(RELEASE_AT_LOCAL, TZ);
      if (RELEASE_AT)
        console.log('🕒 Parsed RELEASE_AT (UTC):', RELEASE_AT.toISOString());
    } catch (e) {
      console.log('⚠️ Could not parse RELEASE_AT_LOCAL with date-fns-tz:', e);
      RELEASE_AT = null;
    }
  }

  // Navigate to tee sheet and ensure we're on the tee-sheet page
  // Ensure navigation starts even if storageState doesn't redirect — load the tee-sheet page explicitly
  await page.goto('https://members.brsgolf.com/galgorm/tee-sheet/1', {
    waitUntil: 'load',
  });
  // Auto-login fallback if storageState didn't redirect us into a logged-in area
  await ensureLoggedIn(page);
  // Helper: robust navigation from Home (or other pages) to the tee sheet
  async function goToTeeSheet(page: import('@playwright/test').Page) {
    // If we're already on a tee-sheet URL, return
    if (/\/tee-sheet\//.test(page.url())) return;

    // Try left-nav “Tee Sheet” first (button or link)
    const navTee = page
      .getByRole('link', { name: /tee sheet/i })
      .first()
      .or(page.getByRole('button', { name: /tee sheet/i }).first());

    if (await navTee.isVisible().catch(() => false)) {
      await navTee.click();
      return;
    }

    // Fallback: big “BOOK A TEE TIME” button on Home
    const bookBtn = page
      .getByRole('button', { name: /book a tee time/i })
      .first();
    if (await bookBtn.isVisible().catch(() => false)) {
      try {
        await bookBtn.scrollIntoViewIfNeeded();
      } catch {}
      await bookBtn.click();
      return;
    }

    // Last resort: click a link with “Bookings” then “Tee Sheet”
    const bookings = page
      .getByRole('link', { name: /bookings/i })
      .first()
      .or(page.getByRole('button', { name: /bookings/i }).first());
    if (await bookings.isVisible().catch(() => false)) {
      await bookings.click();
      const ts = page
        .getByRole('link', { name: /tee sheet/i })
        .first()
        .or(page.getByRole('button', { name: /tee sheet/i }).first());
      if (await ts.isVisible().catch(() => false)) await ts.click();
    }
  }
  // Try robust navigation from home -> tee sheet if needed
  await goToTeeSheet(page);
  console.log('➡️ Navigated to tee sheet (or already there)');
  console.log('⏳ Waiting for tee sheet...');
  await waitForTeeSheet(page);
  console.log('✅ Tee sheet ready');

  // Use rootForTee(page) later to select the correct root (iframe-aware)

  // Optionally open the calendar and select the target date (if parsed)
  const targetDay = env.TARGET_DAY;
  if (targetDay) {
    await openCalendar(page);
    const ok = await selectCalendarDay(page, targetDay);
    if (!ok)
      throw new Error(
        `Could not find enabled day "${targetDay}" in the calendar (tried 12 months)`,
      );
    console.log('⏳ Waiting for tee sheet after date select...');
    await waitForTeeSheet(page);
    console.log('📅 Date applied, sheet reloaded');
  }

  // Wait for the tee-sheet rows to render. Different tee-sheet UIs use
  // different classes/structures, so try several common selectors and
  // fall back to waiting for any time string to appear.
  const rowsSelectors =
    '.tee-row, .tee-time-row, tr.tee-row, .slot-row, .slot, .timeslot, .time-slot, .availability, .tee-time, .teeRow';
  const rows = page.locator(rowsSelectors);

  const rowsVisible = await rows
    .first()
    .isVisible()
    .catch(() => false);
  if (rowsVisible) {
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
  } else {
    // Fallback: wait for any time-like pattern to appear on the page
    const timePatternFallback = page
      .locator('text=/\\b(?:0?\\d|1\\d|2[0-3]):[0-5]\\d\\b/')
      .first();
    console.log(
      '⚠️ Rows selectors did not match; falling back to waiting for any time-like text',
    );
    await timePatternFallback.waitFor({ state: 'visible', timeout: 15000 });
  }

  // Helper: resilient OR-style readiness check for the tee sheet
  async function waitForTeeSheet(page: import('@playwright/test').Page) {
    // Log URL + title to aid debugging
    console.log('URL:', page.url());
    try {
      console.log('Title:', await page.title());
    } catch {}

    // Accept cookie banners if present
    const cookie = page
      .locator('button:has-text("Accept"), button:has-text("I Agree")')
      .first();
    if (await cookie.isVisible().catch(() => false))
      await cookie.click().catch(() => {});

    // Define signals that the tee sheet is actually rendered.
    const dateHeader = page
      .locator('button', {
        hasText: /JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC/i,
      })
      .first();
    const anyTime = page
      .locator('text=/\\b(?:0?\\d|1\\d|2[0-3]):[0-5]\\d\\b/')
      .first();
    const anyAction = page
      .locator(
        'button:has-text("Book"), button:has-text("Waiting"), a:has-text("Book"), [role="button"]:has-text("Book")',
      )
      .first();

    // Wait for any ONE of these to become visible.
    const start = Date.now();
    while (Date.now() - start < 30000) {
      if (await dateHeader.isVisible().catch(() => false)) {
        console.log('✅ date header visible');
        return;
      }
      if (await anyTime.isVisible().catch(() => false)) {
        console.log('✅ a tee time is visible');
        return;
      }
      if (await anyAction.isVisible().catch(() => false)) {
        console.log('✅ a booking action is visible');
        return;
      }
      await page.waitForTimeout(300);
    }
    throw new Error(
      'Tee sheet not detected within 30s (no date header, times, or buttons).',
    );
  }

  // Iterate preferred times
  // Acquire root (iframe-aware) for subsequent locators
  // Use `let` so we can refresh the root if the calendar navigation changes iframes
  let root = await rootForTee(page);

  // Ensure the page (or iframe root) contains at least one time-like pattern before scanning specific targets
  const timePattern = root.locator(
    'text=/\\b(?:0?\\d|1\\d|2[0-3]):[0-5]\\d\\b/',
  );
  await timePattern
    .first()
    .waitFor({ state: 'visible', timeout: 15000 })
    .catch(() => {});

  console.log('🔎 Looking for time...', env.TARGET_TIMES.join(', '));
  // Helper: read visible times on the provided root and return sorted array of 'HH:MM' strings
  async function getVisibleTimes(root: any) {
    const texts = await root
      .locator('text=/\\b(?:0?\\d|1\\d|2[0-3]):[0-5]\\d\\b/')
      .allTextContents();
    const set = new Set<string>();
    for (const txtRaw of texts) {
      const txt = (txtRaw ?? '').trim();
      const m = txt.match(/(\d{1,2}:\d{2})/);
      if (m && m[1]) set.add(m[1].padStart(5, '0'));
    }
    // Sort times ascending (defensive parsing)
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

  const availableTimes = await getVisibleTimes(root);
  console.log(
    'ℹ️ Available times on page:',
    availableTimes.join(', ') || '<none>',
  );

  // For each preferred time, find the first available time >= preferred
  const desiredCandidates: string[] = [];
  for (const pref of env.TARGET_TIMES) {
    const [phStr = '0', pmStr = '0'] = pref.split(':');
    const ph = parseInt(phStr, 10) || 0;
    const pm = parseInt(pmStr, 10) || 0;
    const prefMinutes = ph * 60 + pm;
    const candidate = availableTimes.find((t) => {
      const [thStr = '0', tmStr = '0'] = t.split(':');
      const th = parseInt(thStr, 10) || 0;
      const tm = parseInt(tmStr, 10) || 0;
      return th * 60 + tm >= prefMinutes;
    });
    if (candidate) desiredCandidates.push(candidate);
  }

  if (desiredCandidates.length === 0) {
    console.log(
      '⚠️ No available times meet preferred windows; available times:',
      availableTimes.join(', '),
    );
    // continue with original exact-match attempt (to keep behavior) by iterating env.TARGET_TIMES
  }

  const candidatesToTry = Array.from(
    new Set(
      desiredCandidates.length > 0 ? desiredCandidates : env.TARGET_TIMES,
    ),
  );
  // Forward-search fallback: scan current date for actionable slots, and if none
  // are found, hop forward up to SEARCH_DAYS to find the next actionable date.
  function toISO(d: Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  async function scanCurrentDateForActionable(
    root: any,
    preferredTimes: string[],
    clickWaitlist: boolean,
    dryRun = true,
  ) {
    const timeRegex = /\b(?:0?\d|1\d|2[0-3]):[0-5]\d\b/;
    const table = root.locator('table:has(tr), [role="grid"]:has(tr)').first();
    let rows: any;
    if (await table.isVisible().catch(() => false)) {
      rows = table.locator('tbody tr, tr');
    } else {
      // Fallback to common row-like selectors when the tee-sheet is not a table
      rows = root.locator(
        '.tee-row, .slot-row, .timeslot, .slot, .availability, tr',
      );
    }
    const count = await rows.count();
    const results: Array<{
      time: string;
      canBook: boolean;
      canWait: boolean;
      row: any;
      bookBtn: any;
      waitBtn: any;
    }> = [];

    if (count === 0) {
      // debug: capture a few sample time nodes + their ancestor text to aid selector tuning
      const sampleTimeLocs = root.locator(
        'text=/\\b(?:0?\\d|1\\d|2[0-3]):[0-5]\\d\\b/',
      );
      const sampleCount = Math.min(5, await sampleTimeLocs.count());
      for (let s = 0; s < sampleCount; s++) {
        const node = sampleTimeLocs.nth(s);
        const txt = (await node.innerText().catch(() => '')) || '';
        const ancestor = node
          .locator('xpath=ancestor::div | ancestor::tr')
          .first();
        const ancText = (await ancestor.innerText().catch(() => ''))
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 400);
        console.log(
          `🔍 sample time node[${s}] text="${txt.trim()}" ancestor-snippet="${ancText}"`,
        );
      }

      // fallback: scan individual time nodes and derive their containing row
      const timeLocs = root.locator(
        'text=/\\b(?:0?\\d|1\\d|2[0-3]):[0-5]\\d\\b/',
      );
      const tcount = await timeLocs.count();
      for (let i = 0; i < tcount; i++) {
        const timeNode = timeLocs.nth(i);
        const txtRaw = (await timeNode.innerText().catch(() => '')) || '';
        const m = txtRaw.match(new RegExp(timeRegex));
        const time = m ? m[0].trim() : null;
        if (!time) continue;
        const row = timeNode
          .locator(
            'xpath=ancestor::tr | ancestor::div[contains(@class,"row") or contains(@class,"slot") or contains(@class,"tee")]',
          )
          .first();

        const bookBtn = row
          .locator(':is(button,a,[role="button"],.btn):has-text(/\\bbook\\b/i)')
          .first();
        const waitBtn = row
          .locator(
            ':is(button,a,[role="button"],.btn):has-text(/waiting( list)?/i)',
          )
          .first();
        const detailBtn = row
          .locator(':is(button,a):has-text(/detail|booking info|detail/i)')
          .first();

        let canBook = await bookBtn.isVisible().catch(() => false);
        let canWait = await waitBtn.isVisible().catch(() => false);
        // If buttons aren't visible, try clicking the time/row to reveal actions (some UIs show actions only after selecting a time)
        if (!canBook && !canWait) {
          try {
            await timeNode.click().catch(() => {});
            await page.waitForTimeout(250);
            canBook = await bookBtn.isVisible().catch(() => false);
            canWait = await waitBtn.isVisible().catch(() => false);
          } catch (e) {
            // ignore
          }
        }
        if (!canBook && !canWait) {
          const hasDetail = await detailBtn.isVisible().catch(() => false);
          if (hasDetail) {
            if (dryRun) {
              canBook = true;
            } else {
              try {
                await detailBtn.click().catch(() => {});
                const modalSelectors = [
                  '.mat-dialog-container',
                  '.modal',
                  '[role="dialog"]',
                  '.dialog',
                ];
                let foundModal: string | null = null;
                for (const sel of modalSelectors) {
                  if (
                    (await root
                      .locator(sel)
                      .first()
                      .isVisible()
                      .catch(() => false)) ||
                    (await page
                      .locator(sel)
                      .first()
                      .isVisible()
                      .catch(() => false))
                  ) {
                    foundModal = sel;
                    break;
                  }
                }
                if (foundModal) {
                  let bookInModal = root
                    .locator(
                      `${foundModal} :is(button,a,[role="button"]):has-text(/\\bbook\\b/i)`,
                    )
                    .first();
                  if (!(await bookInModal.isVisible().catch(() => false)))
                    bookInModal = page
                      .locator(
                        `${foundModal} :is(button,a,[role="button"]):has-text(/\\bbook\\b/i)`,
                      )
                      .first();
                  let waitInModal = root
                    .locator(
                      `${foundModal} :is(button,a,[role="button"]):has-text(/waiting( list)?/i)`,
                    )
                    .first();
                  if (!(await waitInModal.isVisible().catch(() => false)))
                    waitInModal = page
                      .locator(
                        `${foundModal} :is(button,a,[role="button"]):has-text(/waiting( list)?/i)`,
                      )
                      .first();
                  if (await bookInModal.isVisible().catch(() => false)) {
                    return {
                      found: true,
                      chosen: {
                        time,
                        canBook: true,
                        canWait: false,
                        row,
                        bookBtn: bookInModal,
                        waitBtn: null,
                      },
                    };
                  }
                  if (await waitInModal.isVisible().catch(() => false)) {
                    return {
                      found: true,
                      chosen: {
                        time,
                        canBook: false,
                        canWait: true,
                        row,
                        bookBtn: null,
                        waitBtn: waitInModal,
                      },
                    };
                  }
                }
              } catch (e) {
                // ignore modal flow failures and continue scanning
              } finally {
                let closeBtn = root
                  .locator(
                    ':is(button,a):has-text("Close"), button[aria-label="Close"]',
                  )
                  .first();
                if (!(await closeBtn.isVisible().catch(() => false)))
                  closeBtn = page
                    .locator(
                      ':is(button,a):has-text("Close"), button[aria-label="Close"]',
                    )
                    .first();
                if (await closeBtn.isVisible().catch(() => false))
                  await closeBtn.click().catch(() => {});
              }
            }
          } else {
            // If there is no per-row detail control, try the page-level header controls
            const headerDetail = page
              .locator(
                'button:has-text("Detail"), button:has-text("Booking Info"), button:has-text("Booking info")',
              )
              .first();
            const headerVisible = await headerDetail
              .isVisible()
              .catch(() => false);
            if (headerVisible) {
              if (dryRun) {
                canBook = true;
              } else {
                try {
                  await headerDetail.click().catch(() => {});
                  const modalSelectors = [
                    '.mat-dialog-container',
                    '.modal',
                    '[role="dialog"]',
                    '.dialog',
                  ];
                  let foundModal: string | null = null;
                  for (const sel of modalSelectors) {
                    if (
                      (await root
                        .locator(sel)
                        .first()
                        .isVisible()
                        .catch(() => false)) ||
                      (await page
                        .locator(sel)
                        .first()
                        .isVisible()
                        .catch(() => false))
                    ) {
                      foundModal = sel;
                      break;
                    }
                  }
                  if (foundModal) {
                    let bookInModal = root
                      .locator(
                        `${foundModal} :is(button,a,[role="button"]):has-text(/\\bbook\\b/i)`,
                      )
                      .first();
                    if (!(await bookInModal.isVisible().catch(() => false)))
                      bookInModal = page
                        .locator(
                          `${foundModal} :is(button,a,[role="button"]):has-text(/\\bbook\\b/i)`,
                        )
                        .first();
                    let waitInModal = root
                      .locator(
                        `${foundModal} :is(button,a,[role="button"]):has-text(/waiting( list)?/i)`,
                      )
                      .first();
                    if (!(await waitInModal.isVisible().catch(() => false)))
                      waitInModal = page
                        .locator(
                          `${foundModal} :is(button,a,[role="button"]):has-text(/waiting( list)?/i)`,
                        )
                        .first();
                    if (await bookInModal.isVisible().catch(() => false)) {
                      return {
                        found: true,
                        chosen: {
                          time,
                          canBook: true,
                          canWait: false,
                          row,
                          bookBtn: bookInModal,
                          waitBtn: null,
                        },
                      };
                    }
                    if (await waitInModal.isVisible().catch(() => false)) {
                      return {
                        found: true,
                        chosen: {
                          time,
                          canBook: false,
                          canWait: true,
                          row,
                          bookBtn: null,
                          waitBtn: waitInModal,
                        },
                      };
                    }
                  }
                } catch (e) {
                  // ignore
                } finally {
                  let closeBtn = root
                    .locator(
                      ':is(button,a):has-text("Close"), button[aria-label="Close"]',
                    )
                    .first();
                  if (!(await closeBtn.isVisible().catch(() => false)))
                    closeBtn = page
                      .locator(
                        ':is(button,a):has-text("Close"), button[aria-label="Close"]',
                      )
                      .first();
                  if (await closeBtn.isVisible().catch(() => false))
                    await closeBtn.click().catch(() => {});
                }
              }
            }
          }
        }

        results.push({ time, canBook, canWait, row, bookBtn, waitBtn });
      }
    } else {
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
          .locator(
            ':is(button,a,[role="button"],.btn):has-text(/waiting( list)?/i)',
          )
          .first();
        const detailBtn = row
          .locator(':is(button,a):has-text(/detail|booking info|detail/i)')
          .first();
        let canBook = await bookBtn.isVisible().catch(() => false);
        let canWait = await waitBtn.isVisible().catch(() => false);
        // Try selecting the row/time to reveal any hidden action buttons
        if (!canBook && !canWait) {
          try {
            const clickable = row
              .locator(`text=/\\b${time.replace(':', '\\:')}\\b/`)
              .first();
            await clickable.click().catch(() => {});
            await page.waitForTimeout(250);
            canBook = await bookBtn.isVisible().catch(() => false);
            canWait = await waitBtn.isVisible().catch(() => false);
          } catch (e) {
            // ignore
          }
        }
        if (!canBook && !canWait) {
          const hasDetail = await detailBtn.isVisible().catch(() => false);
          if (hasDetail) {
            if (dryRun) {
              // mark as "bookable" only for dry-run so the test can report it
              canBook = true;
            } else {
              // Try opening the detail modal/dialog and look for Book/Waiting inside
              try {
                await detailBtn.click().catch(() => {});
                const modalSelectors = [
                  '.mat-dialog-container',
                  '.modal',
                  '[role="dialog"]',
                  '.dialog',
                ];
                let foundModal: string | null = null;
                for (const sel of modalSelectors) {
                  if (
                    await page
                      .locator(sel)
                      .first()
                      .isVisible()
                      .catch(() => false)
                  ) {
                    foundModal = sel;
                    break;
                  }
                }
                if (foundModal) {
                  const bookInModal = page
                    .locator(
                      `${foundModal} :is(button,a,[role="button"]):has-text(/\\bbook\\b/i)`,
                    )
                    .first();
                  const waitInModal = page
                    .locator(
                      `${foundModal} :is(button,a,[role="button"]):has-text(/waiting( list)?/i)`,
                    )
                    .first();
                  if (await bookInModal.isVisible().catch(() => false)) {
                    return {
                      found: true,
                      chosen: {
                        time,
                        canBook: true,
                        canWait: false,
                        row,
                        bookBtn: bookInModal,
                        waitBtn: null,
                      },
                    };
                  }
                  if (await waitInModal.isVisible().catch(() => false)) {
                    return {
                      found: true,
                      chosen: {
                        time,
                        canBook: false,
                        canWait: true,
                        row,
                        bookBtn: null,
                        waitBtn: waitInModal,
                      },
                    };
                  }
                }
              } catch (e) {
                // ignore modal flow failures and continue scanning
              } finally {
                // try to close any modal that might have opened
                const closeBtn = page
                  .locator(
                    ':is(button,a):has-text("Close"), button[aria-label="Close"]',
                  )
                  .first();
                if (await closeBtn.isVisible().catch(() => false))
                  await closeBtn.click().catch(() => {});
              }
            }
          }
        }

        results.push({ time, canBook, canWait, row, bookBtn, waitBtn });
      }
    }

    console.log(
      '🗒️ Slots summary:',
      results
        .map(
          (r) =>
            `${r.time} — ${
              r.canBook ? 'Book' : r.canWait ? 'Waiting' : 'Unavailable'
            }`,
        )
        .join(', '),
    );

    const toMins = (t: string) => {
      const [h = '0', m = '0'] = t.split(':');
      return Number(h) * 60 + Number(m);
    };
    const pref = preferredTimes.map((t) => t.trim()).filter(Boolean);
    for (const p of pref) {
      const pm = toMins(p);
      const cand = results
        .filter((r) => r.canBook || (clickWaitlist && r.canWait))
        .sort((a, b) => toMins(a.time) - toMins(b.time))
        .find((r) => toMins(r.time) >= pm);
      if (cand) return { found: true, chosen: cand };
    }
    const any = results
      .filter((r) => r.canBook || (clickWaitlist && r.canWait))
      .sort((a, b) => toMins(a.time) - toMins(b.time))[0];
    if (any) return { found: true, chosen: any };
    return { found: false };
  }
  // Helper: split YYYY-MM-DD into numeric y/m/d
  function splitISO(iso: string) {
    const [y, m, d] = iso.split('-').map(Number);
    return { y, m, d };
  }
  async function gotoTeeDate(
    page: import('@playwright/test').Page,
    iso: string,
  ) {
    const { y, m, d } = splitISO(iso);
    const url = `https://members.brsgolf.com/galgorm/tee-sheet/1/${y}/${String(
      m,
    ).padStart(2, '0')}/${String(d).padStart(2, '0')}`;
    console.log('🔗 Navigating to date URL:', url);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  const root0 = await rootForTee(page);
  let activeDateISO = env.RAW_TARGET_DATE || toISO(new Date());
  let found = await scanCurrentDateForActionable(
    root0,
    env.TARGET_TIMES,
    env.CLICK_WAITLIST,
    env.DRY_RUN,
  );

  for (let hop = 0; !found.found && hop < SEARCH_DAYS; hop++) {
    const base = new Date(activeDateISO);
    base.setDate(base.getDate() + 1);
    activeDateISO = toISO(base);
    console.log(`➡️ No actionable slots; trying ${activeDateISO} by URL`);

    await gotoTeeDate(page, activeDateISO);
    console.log('⏳ Waiting for tee sheet after URL hop...');
    await waitForTeeSheet(page);

    const rootNext = await rootForTee(page);
    found = await scanCurrentDateForActionable(
      rootNext,
      env.TARGET_TIMES,
      env.CLICK_WAITLIST,
    );
  }

  if (!found.found)
    throw new Error(
      `No bookable or waiting-list slots found within ${SEARCH_DAYS} day(s).`,
    );

  const chosen = found.chosen!;
  const actionType = chosen.canBook ? 'Book' : 'Waiting';
  console.log(`🎯 Selected ${actionType} @ ${chosen.time} on ${activeDateISO}`);

  if (env.DRY_RUN) {
    console.log(
      `🧪 DRY-RUN: would click ${actionType} for ${chosen.time} on ${activeDateISO}`,
    );
    return;
  }

  const btn = chosen.canBook ? chosen.bookBtn : chosen.waitBtn;
  try {
    await btn.scrollIntoViewIfNeeded();
  } catch {}
  await btn.click();
  const success = page
    .locator(
      'text=/Booking|Booked|Confirmed|Confirmation|Waiting list|Added to waiting list/i',
    )
    .first();
  await expect(success).toBeVisible({ timeout: 12000 });
  console.log('🎉 Flow reached success message');

  return;
});
