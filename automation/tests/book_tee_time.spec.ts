import { test, expect } from '@playwright/test';
import { waitForTeeSheet, openCalendar, selectCalendarDay } from './helpers.js';

// iframe-aware root selector (copied minimal version from book_slot.spec.ts)
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

/**
 * Env configuration (set these in .env)
 * FS_TARGET_DATE      = 2025-10-25         // YYYY-MM-DD (optional; if omitted, stays on whatever date the sheet shows)
 * FS_TARGET_TIMES     = 07:56,08:04        // comma-separated list of preferred times (24h or 12h with leading zeroes)
 * FS_DRY_RUN          = true               // "true" (default) logs actions only; set "false" to actually click
 * FS_CLICK_WAITLIST   = false              // set "true" to click "Waiting List" if "Book" not present
 */

function parseEnvList(name: string, fallback: string[] = []) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function dateToDayString(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()))
    throw new Error(`Invalid FS_TARGET_DATE: ${iso}`);
  // Day number without leading zero
  return String(d.getDate());
}

test('book preferred tee time (safe by default)', async ({ page }) => {
  const targetDateISO = process.env.FS_TARGET_DATE; // optional
  const targetTimes = parseEnvList('FS_TARGET_TIMES', ['07:56', '08:04']);
  const DRY_RUN = (process.env.FS_DRY_RUN ?? 'true').toLowerCase() !== 'false';
  const CLICK_WAITLIST =
    (process.env.FS_CLICK_WAITLIST ?? 'false').toLowerCase() === 'true';

  console.log('⚙️ Config -> date:', targetDateISO ?? '(current sheet)');
  console.log('⚙️ Config -> times:', targetTimes.join(', '));
  console.log('⚙️ Config -> dry-run:', DRY_RUN);
  console.log('⚙️ Config -> click-waitlist:', CLICK_WAITLIST);

  // 1) Open tee sheet (already logged in via storageState)
  await page.goto('https://members.brsgolf.com/galgorm/tee-sheet/1');
  await waitForTeeSheet(page);

  // 2) If a target date provided, open calendar and pick that day
  if (targetDateISO) {
    const day = dateToDayString(targetDateISO);
    await openCalendar(page);
    const ok = await selectCalendarDay(page, day);
    if (!ok)
      throw new Error(
        `Could not find enabled day "${day}" in the calendar (tried ${12} months)`,
      );
    await waitForTeeSheet(page);
    console.log(`📅 Switched tee sheet to day ${day} of target month`);
  }

  // 3) Optional: dismiss cookie/banner if present
  const cookieAccept = page
    .locator('button:has-text("Accept"), button:has-text("I Agree")')
    .first();
  if (await cookieAccept.isVisible().catch(() => false)) {
    await cookieAccept.click().catch(() => {});
  }

  // 4) Scan for target time(s), prefer first available in the order given
  const tryBookOne = async (time: string) => {
    console.log(`🔎 Looking for time ${time} ...`);
    // Prefer an exact match, but if the exact preferred time is not present,
    // choose the first visible time >= preferred.
    const root = await rootForTee(page);
    // wait briefly for any time-like text inside the chosen root (iframe content may be a bit delayed)
    try {
      await root
        .locator('text=/\\b(?:0?\\d|1\\d|2[0-3]):[0-5]\\d\\b/')
        .first()
        .waitFor({ state: 'visible', timeout: 5000 });
    } catch (e) {
      // continue; we'll get an empty list below and log that as a diagnostic
    }
    const visibleTimes = await (async () => {
      // reuse getVisibleTimes logic but scoped to root
      const texts = await root
        .locator('text=/\\b(?:0?\\d|1\\d|2[0-3]):[0-5]\\d\\b/')
        .allTextContents()
        .catch(() => []);
      const set = new Set<string>();
      for (const txtRaw of texts) {
        const txt = (txtRaw ?? '').trim();
        const m = txt.match(/(\d{1,2}:\d{2})/);
        if (m && m[1]) set.add(m[1].padStart(5, '0'));
      }
      return Array.from(set).sort((a, b) => {
        const [ah = '0', am = '0'] = a.split(':');
        const [bh = '0', bm = '0'] = b.split(':');
        return (
          (parseInt(ah, 10) || 0) * 60 +
          (parseInt(am, 10) || 0) -
          ((parseInt(bh, 10) || 0) * 60 + (parseInt(bm, 10) || 0))
        );
      });
    })();
    const [phStr = '0', pmStr = '0'] = time.split(':');
    const prefMinutes =
      (parseInt(phStr, 10) || 0) * 60 + (parseInt(pmStr, 10) || 0);
    let candidate = visibleTimes.find((t) => {
      const [th = '0', tm = '0'] = t.split(':');
      return (
        (parseInt(th, 10) || 0) * 60 + (parseInt(tm, 10) || 0) >= prefMinutes
      );
    });
    // fallback to exact match in case formatting differs
    if (!candidate) candidate = visibleTimes.find((t) => t === time);
    if (!candidate) {
      console.log(
        `⚠️ Preferred time ${time} not present; visible times: ${visibleTimes.join(
          ', ',
        )}`,
      );
      return false;
    }
    const timeEl = root
      .locator(`text=/\\b${candidate.replace(':', '\\:')}\\b/`)
      .first();
    await timeEl.waitFor({ state: 'visible', timeout: 8000 });

    // Hop to its containing row (works for table rows or card rows)
    const row = timeEl
      .locator(
        'xpath=ancestor::tr | ancestor::div[contains(@class,"row") or contains(@class,"tee")]',
      )
      .first();

    // Check for actionable buttons in that row (support links like "Book Now" and buttons)
    const bookBtn = row
      .locator(':is(button,a,[role="button"]):has-text(/\\bbook\\b/i)')
      .first();
    const waitBtn = row
      .locator(
        ':is(button,a,[role="button"]):has-text(/waiting( list)?|wait/i)',
      )
      .first();

    const hasBook = await bookBtn.isVisible().catch(() => false);
    const hasWait = await waitBtn.isVisible().catch(() => false);

    if (!hasBook && !hasWait) {
      // Try clicking the time element to reveal actions (some UIs show actions only after selecting the time)
      try {
        await timeEl.click().catch(() => {});
        await page.waitForTimeout(250);
      } catch {}

      const hasBookNow = await bookBtn.isVisible().catch(() => false);
      const hasWaitNow = await waitBtn.isVisible().catch(() => false);
      if (hasBookNow || hasWaitNow) {
        if (DRY_RUN) {
          console.log(
            `🧪 DRY-RUN: would click -> ${
              hasBookNow ? 'Book' : 'Waiting List'
            } for ${time}`,
          );
          return true;
        }
      }

      // If still no action in-row, try clicking the page-level "Detail" / "Booking Info" button
      const headerDetail = page
        .locator(
          'button:has-text("Detail"), button:has-text("Booking Info"), button:has-text("Booking info")',
        )
        .first();
      const headerCount = await page
        .locator(
          'button:has-text("Detail"), button:has-text("Booking Info"), button:has-text("Booking info")',
        )
        .count()
        .catch(() => 0);
      const headerVisible =
        headerCount > 0 && (await headerDetail.isVisible().catch(() => false));
      if (headerCount > 0) {
        if (DRY_RUN) {
          console.log(
            `🧪 DRY-RUN: header Detail/Booking Info present for ${time}`,
          );
          return true;
        }
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
              if (DRY_RUN) {
                console.log(
                  `🧪 DRY-RUN: would click Book in modal for ${time}`,
                );
                return true;
              }
              await bookInModal.click().catch(() => {});
              return true;
            }
            if (await waitInModal.isVisible().catch(() => false)) {
              if (DRY_RUN) {
                console.log(
                  `🧪 DRY-RUN: would click Waiting in modal for ${time}`,
                );
                return true;
              }
              await waitInModal.click().catch(() => {});
              return true;
            }
          }
        } catch (e) {
          // ignore and return false below
        } finally {
          const closeBtn = page
            .locator(
              ':is(button,a):has-text("Close"), button[aria-label="Close"]',
            )
            .first();
          if (await closeBtn.isVisible().catch(() => false))
            await closeBtn.click().catch(() => {});
        }
      }

      console.log(`⛔ No Book/Wait button visible for ${time}`);
      return false;
    }

    if (DRY_RUN) {
      console.log(
        `🧪 DRY-RUN: would click -> ${
          hasBook ? 'Book' : hasWait ? 'Waiting List' : 'None'
        } for ${time}`,
      );
      return true;
    }

    if (hasBook) {
      console.log(`✅ Clicking Book for ${time}`);
      await bookBtn.click();
    } else if (hasWait && CLICK_WAITLIST) {
      console.log(`✅ Clicking Waiting List for ${time}`);
      await waitBtn.click();
    } else {
      console.log(
        `⚠️ Skipping ${time} (Book not available and CLICK_WAITLIST=false)`,
      );
      return false;
    }

    // 5) Handle common follow-ups: confirm/proceed dialogs
    const followUp = page
      .locator(
        'button:has-text("Confirm"), button:has-text("Continue"), button:has-text("Proceed"), button:has-text("Next")',
      )
      .first();
    if (await followUp.isVisible().catch(() => false)) {
      await followUp.click().catch(() => {});
      await waitForTeeSheet(page).catch(() => {});
    }

    // Basic success heuristic (tweak if your site shows a specific message)
    const successText = page.locator(
      'text=/Booking|Confirmed|Success|Added to Waiting List/i',
    );
    if (
      await successText
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      console.log('🎉 Booking flow reached a success-like page/label.');
    } else {
      console.log(
        'ℹ️ No explicit success message detected — check the UI/trace to verify.',
      );
    }

    return true;
  };

  async function getVisibleTimes(page: import('@playwright/test').Page) {
    // Prefer times inside a tee-sheet iframe if present
    const frameSelectors = [
      'iframe[src*="tee"]',
      'iframe[id*="tee"]',
      'iframe[src*="sheet"]',
      'iframe',
    ];
    for (const fsel of frameSelectors) {
      try {
        const count = await page.locator(fsel).count();
        if (count > 0) {
          const fl = page.frameLocator(fsel);
          const fcount = await fl
            .locator('text=/\\b(?:0?\\d|1\\d|2[0-3]):[0-5]\\d\\b/')
            .count()
            .catch(() => 0);
          if (fcount > 0) {
            const texts = await fl
              .locator('text=/\\b(?:0?\\d|1\\d|2[0-3]):[0-5]\\d\\b/')
              .allTextContents();
            const set = new Set<string>();
            for (const txtRaw of texts) {
              const txt = (txtRaw ?? '').trim();
              const m = txt.match(/(\d{1,2}:\d{2})/);
              if (m && m[1]) set.add(m[1].padStart(5, '0'));
            }
            return Array.from(set).sort((a, b) => {
              const [ah = '0', am = '0'] = a.split(':');
              const [bh = '0', bm = '0'] = b.split(':');
              return (
                (parseInt(ah, 10) || 0) * 60 +
                (parseInt(am, 10) || 0) -
                ((parseInt(bh, 10) || 0) * 60 + (parseInt(bm, 10) || 0))
              );
            });
          }
        }
      } catch (e) {
        // ignore and continue
      }
    }

    const texts = await page
      .locator('text=/\\b(?:0?\\d|1\\d|2[0-3]):[0-5]\\d\\b/')
      .allTextContents();
    const set = new Set<string>();
    for (const txtRaw of texts) {
      const txt = (txtRaw ?? '').trim();
      const m = txt.match(/(\d{1,2}:\d{2})/);
      if (m && m[1]) set.add(m[1].padStart(5, '0'));
    }
    return Array.from(set).sort((a, b) => {
      const [ah = '0', am = '0'] = a.split(':');
      const [bh = '0', bm = '0'] = b.split(':');
      return (
        (parseInt(ah, 10) || 0) * 60 +
        (parseInt(am, 10) || 0) -
        ((parseInt(bh, 10) || 0) * 60 + (parseInt(bm, 10) || 0))
      );
    });
  }

  let booked = false;
  for (const t of targetTimes) {
    try {
      booked = await tryBookOne(t);
      if (booked) break;
    } catch (err) {
      console.log(`⚠️ Error while trying ${t}:`, (err as Error).message);
    }
  }

  expect(booked).toBeTruthy(); // if dry-run=true and a target time was found, this is true
});
