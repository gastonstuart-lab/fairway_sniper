import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { waitForTeeSheet } from './helpers.js';

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
    const { createRequire } = await import('module');
    const req = createRequire(import.meta.url);
    const _df = req('date-fns-tz');
    return _df.zonedTimeToUtc ?? _df.default?.zonedTimeToUtc ?? _df;
  }
}

// Use authenticated state saved previously
test.use({ storageState: 'state.json' });

// Small helpers
function toISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function splitISO(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

// Timezone-aware release configuration
const TZ = process.env.FS_TZ || 'Europe/London';
const RELEASE_AT_LOCAL = process.env.FS_RELEASE_AT_LOCAL || '';
let RELEASE_AT: Date | null = null;

const FS_DRY_RUN = (process.env.FS_DRY_RUN ?? 'true').toLowerCase() === 'true';
const CLICK_WAITLIST =
  (process.env.FS_CLICK_WAITLIST ?? 'false').toLowerCase() === 'true';
const COURSE_ID = process.env.FS_COURSE_ID ?? '1';
const TARGET_DATE = process.env.FS_TARGET_DATE ?? toISO(new Date());
const TARGET_TIMES = (process.env.FS_TARGET_TIMES ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const WINDOW_BEFORE_MS = Number(process.env.FS_WINDOW_BEFORE_MS ?? '30000');
const WINDOW_AFTER_MS = Number(process.env.FS_WINDOW_AFTER_MS ?? '30000');
const REFRESH_HZ = Number(process.env.FS_REFRESH_HZ ?? '1');
const POLL_MS = Number(process.env.FS_POLL_MS ?? '15');

// Small iframe-aware root helper (minimal, independent)
async function rootForTee(page: import('@playwright/test').Page) {
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
      const hasTime = await fl
        .locator(timePattern)
        .first()
        .count()
        .catch(() => 0);
      if (hasTime > 0) return fl;
    } catch {
      // ignore
    }
  }
  return page;
}

// Find action buttons in a table row that contains the time string
async function findActionForTime(root: any, time: string) {
  const table = root.locator('table:has(tr), [role="grid"]:has(tr)').first();
  if (!(await table.isVisible().catch(() => false)))
    return { bookBtn: null, waitBtn: null, row: null };
  const rows = table.locator('tbody tr, tr');
  const count = await rows.count();
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const firstCell = row.locator('td, [role="gridcell"]').first();
    const txt = (await firstCell.innerText().catch(() => '')).trim();
    if (txt === time) {
      const actionCell = row.locator('td, [role="gridcell"]').nth(1).or(row);
      const bookBtn = actionCell
        .locator(':is(button,a,[role="button"]):has-text(/\\bbook\\b/i)')
        .first();
      const waitBtn = actionCell
        .locator(':is(button,a,[role="button"]):has-text(/waiting( list)?/i)')
        .first();
      return { bookBtn, waitBtn, row };
    }
  }
  // If no direct action found in table, return nulls so caller can try alternative flows
  return { bookBtn: null, waitBtn: null, row: null };
}

// Navigation to specific tee-sheet date URL
async function gotoTeeDate(
  page: import('@playwright/test').Page,
  courseId: string,
  iso: string,
) {
  const { y, m, d } = splitISO(iso);
  const url = `https://members.brsgolf.com/galgorm/tee-sheet/${courseId}/${y}/${String(
    m,
  ).padStart(2, '0')}/${String(d).padStart(2, '0')}`;
  console.log('🔗 Navigating to date URL:', url);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
}

test.describe('sniper', () => {
  test('fire on release', async ({ page }) => {
    test.setTimeout(5 * 60 * 1000);

    console.log('⚙️ Sniper config', {
      dryRun: FS_DRY_RUN,
      tz: TZ,
      releaseAtLocal: RELEASE_AT_LOCAL || null,
      courseId: COURSE_ID,
      targetDate: TARGET_DATE,
      targetTimes: TARGET_TIMES,
      clickWaitlist: CLICK_WAITLIST,
      windowBeforeMs: WINDOW_BEFORE_MS,
      windowAfterMs: WINDOW_AFTER_MS,
      refreshHz: REFRESH_HZ,
    });

    // Compute RELEASE_AT at runtime to avoid module load issues
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

    // Block heavy resources at context-level to reduce latency
    await page.context().route('**/*', (route) => {
      const req = route.request();
      const t = req.resourceType();
      if (['image', 'font', 'media', 'stylesheet'].includes(t))
        return route.abort();
      const u = req.url();
      if (/analytics|googletagmanager|facebook|doubleclick/i.test(u))
        return route.abort();
      return route.continue();
    });

    // Navigate to target date
    await gotoTeeDate(page, COURSE_ID, TARGET_DATE);

    // Wait for tee sheet using shared robust helper
    await waitForTeeSheet(page);

    // Precompute row locators for preferred times (sensors)
    let root = await rootForTee(page);
    const sensors: Array<{ time: string }> = TARGET_TIMES.map((t) => ({
      time: t,
    }));

    const releaseMs =
      RELEASE_AT instanceof Date ? RELEASE_AT.getTime() : Date.now();
    const startMs = Math.max(0, releaseMs - WINDOW_BEFORE_MS);
    const endMs = releaseMs + WINDOW_AFTER_MS;

    console.log(
      `🕒 Waiting window: ${new Date(startMs).toISOString()} -> ${new Date(
        endMs,
      ).toISOString()}`,
    );

    // Busy-wait loop with light reload bursts
    let performed = false;
    let lastReload = 0;
    const reloadIntervalMs =
      REFRESH_HZ > 0 ? Math.round(1000 / REFRESH_HZ) : 1000;

    // ensure we don't spin too early
    while (Date.now() < startMs) {
      const toWait = Math.min(100, startMs - Date.now());
      await page.waitForTimeout(toWait);
    }

    // Main scanning loop
    while (Date.now() <= endMs && !performed) {
      // reload bursts
      if (Date.now() - lastReload >= reloadIntervalMs) {
        try {
          await page.reload({ waitUntil: 'domcontentloaded' });
        } catch {}
        lastReload = Date.now();
        // refresh root after reload
        root = await rootForTee(page);
      }

      // tight DOM polling
      for (const s of sensors) {
        const { bookBtn, waitBtn } = await findActionForTime(root, s.time);
        // If no direct buttons found, try quick ‘select time + header Detail’ flow to reveal modal actions
        let modalBook: any = null;
        let modalWait: any = null;
        if (
          (!bookBtn || !(await bookBtn.isVisible().catch(() => false))) &&
          (!waitBtn || !(await waitBtn.isVisible().catch(() => false)))
        ) {
          try {
            // Try clicking the time in the frame or page to select it
            const timeLocator = root
              .locator(`text=/\\b${s.time.replace(':', '\\:')}\\b/`)
              .first();
            if (await timeLocator.isVisible().catch(() => false)) {
              await timeLocator.click({ timeout: 200 }).catch(() => {});
            }
            // Try clicking the header-level Detail / Booking Info button quickly
            const header = page
              .locator(
                'button:has-text("Detail"), button:has-text("Booking Info"), button:has-text("Booking info")',
              )
              .first();
            if (await header.isVisible().catch(() => false)) {
              await header.click().catch(() => {});
              // look for modal buttons in both root and page
              const modalSelectors = [
                '.mat-dialog-container',
                '.modal',
                '[role="dialog"]',
                '.dialog',
              ];
              for (const sel of modalSelectors) {
                const bookInModal = root
                  .locator(
                    `${sel} :is(button,a,[role="button"]):has-text(/\\bbook\\b/i)`,
                  )
                  .first();
                const waitInModal = root
                  .locator(
                    `${sel} :is(button,a,[role="button"]):has-text(/waiting( list)?/i)`,
                  )
                  .first();
                if (await bookInModal.isVisible().catch(() => false)) {
                  modalBook = bookInModal;
                  break;
                }
                if (await waitInModal.isVisible().catch(() => false)) {
                  modalWait = waitInModal;
                  break;
                }
                const bookInPage = page
                  .locator(
                    `${sel} :is(button,a,[role="button"]):has-text(/\\bbook\\b/i)`,
                  )
                  .first();
                const waitInPage = page
                  .locator(
                    `${sel} :is(button,a,[role="button"]):has-text(/waiting( list)?/i)`,
                  )
                  .first();
                if (await bookInPage.isVisible().catch(() => false)) {
                  modalBook = bookInPage;
                  break;
                }
                if (await waitInPage.isVisible().catch(() => false)) {
                  modalWait = waitInPage;
                  break;
                }
              }
              // close any modal if opened (non-blocking)
              const closeBtn = page
                .locator(
                  ':is(button,a):has-text("Close"), button[aria-label="Close"]',
                )
                .first();
              if (await closeBtn.isVisible().catch(() => false))
                await closeBtn.click().catch(() => {});
            }
          } catch (e) {
            // ignore quick modal flow errors
          }
        }
        // check book button
        if (
          (bookBtn && (await bookBtn.isVisible().catch(() => false))) ||
          (modalBook && (await modalBook.isVisible().catch(() => false)))
        ) {
          const btn =
            bookBtn && (await bookBtn.isVisible().catch(() => false))
              ? bookBtn
              : modalBook;
          console.log(`⚡ Detected Book for ${s.time}`);
          if (FS_DRY_RUN) {
            console.log(`DRY-RUN: would click Book @ ${s.time}`);
            performed = true;
            break;
          }
          // attempt quick retries
          let clicked = false;
          for (let attempt = 0; attempt < 3 && !clicked; attempt++) {
            try {
              await btn.scrollIntoViewIfNeeded();
              await btn.click({ timeout: 2000 });
              clicked = true;
            } catch (e) {
              await page.waitForTimeout(80);
            }
          }
          if (clicked) {
            // wait for success cue
            const success = page
              .locator(
                'text=/Booking|Booked|Confirmed|Confirmation|Waiting list|Added to waiting list/i',
              )
              .first();
            await expect(success).toBeVisible({ timeout: 12000 });
            console.log(`🎉 Book click succeeded for ${s.time}`);
            performed = true;
            break;
          }
        }

        // fallback to waiting list if allowed
        if (
          CLICK_WAITLIST &&
          ((waitBtn && (await waitBtn.isVisible().catch(() => false))) ||
            (modalWait && (await modalWait.isVisible().catch(() => false))))
        ) {
          console.log(`⚡ Detected Waiting for ${s.time}`);
          if (FS_DRY_RUN) {
            console.log(`DRY-RUN: would click Waiting @ ${s.time}`);
            performed = true;
            break;
          }
          const btn =
            waitBtn && (await waitBtn.isVisible().catch(() => false))
              ? waitBtn
              : modalWait;
          let clicked = false;
          for (let attempt = 0; attempt < 3 && !clicked; attempt++) {
            try {
              await btn.scrollIntoViewIfNeeded();
              await btn.click({ timeout: 2000 });
              clicked = true;
            } catch (e) {
              await page.waitForTimeout(80);
            }
          }
          if (clicked) {
            const success = page
              .locator(
                'text=/Booking|Booked|Confirmed|Confirmation|Waiting list|Added to waiting list/i',
              )
              .first();
            await expect(success).toBeVisible({ timeout: 12000 });
            console.log(`🎉 Waiting click succeeded for ${s.time}`);
            performed = true;
            break;
          }
        }
      }

      if (performed) break;
      // tight poll
      await page.waitForTimeout(POLL_MS);
    }

    if (!performed) {
      console.log('⏳ No actionable slots detected during window');
    }
  });
});
