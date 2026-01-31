import 'dotenv/config';
import fs from 'fs';
import path from 'path';

import express from 'express';
import cors from 'cors';
import crypto from 'crypto';

const app = express();
app.use(cors());
app.use(express.json());

// GET /api/audit-tail?lines=20 -> returns last N lines of logs/release-snipe.ndjson
app.get('/api/audit-tail', (req, res) => {
  const lines = Math.max(1, Math.min(1000, Number(req.query.lines) || 20));
  let logPath;
  try {
    logPath = path.resolve(typeof __dirname !== 'undefined' ? __dirname : process.cwd(), 'logs', 'release-snipe.ndjson');
  } catch { logPath = path.join(process.cwd(), 'logs', 'release-snipe.ndjson'); }
  fs.promises.readFile(logPath, 'utf8')
    .then(data => {
      const arr = data.trim().split(/\r?\n/).slice(-lines).map(l => {
        try { return JSON.parse(l); } catch { return l; }
      });
      res.json({ lines: arr });
    })
    .catch(() => res.json({ lines: [] }));
});

process.on('uncaughtException', (err) => {
  logFatal('uncaughtException', err);
});

process.on('unhandledRejection', (reason) => {
  logFatal('unhandledRejection', reason);
});

process.on('beforeExit', (code) => {
  console.error(`\n[beforeExit] code=${code}`);
  try {
    const handles = process._getActiveHandles?.() || [];
    const requests = process._getActiveRequests?.() || [];
    console.error('[beforeExit] activeHandles:', handles.map(h => h?.constructor?.name || typeof h));
    console.error('[beforeExit] activeRequests:', requests.map(r => r?.constructor?.name || typeof r));
  } catch (e) {
    console.error('[beforeExit] failed to inspect handles', e?.message || e);
  }
});

process.on('exit', (code) => {
  console.error(`\n[exit] code=${code}`);
});

// Graceful shutdown
let server = null;
function shutdown(signal) {
  console.log(`\n[${signal}] shutting down...`);
  try {
    server?.close(() => {
      console.log('[shutdown] server closed');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref?.();
  } catch (e) {
    process.exit(1);
  }
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

const DEBUG_KEEPALIVE = process.env.DEBUG_KEEPALIVE === '1';
if (DEBUG_KEEPALIVE) {
  setInterval(() => {
    console.log('[keepalive]', new Date().toISOString());
  }, 30000);
}

// ========================================
// CONFIGURATION FROM ENVIRONMENT VARIABLES
// ========================================

const CONFIG = {
  CLUB_LOGIN_URL:
    process.env.CLUB_LOGIN_URL || 'https://members.brsgolf.com/galgorm/login',
  TZ_LONDON: process.env.TZ_LONDON || 'Europe/London',
  BRS_USERNAME: process.env.BRS_USERNAME,
  BRS_PASSWORD: process.env.BRS_PASSWORD,
  FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
  FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  FCM_SERVER_KEY: process.env.FCM_SERVER_KEY,
  CAPTCHA_API_KEY: process.env.CAPTCHA_API_KEY || '',
  DRY_RUN: process.argv.includes('--dry-run'),
};

// ========================================
// FIREBASE INITIALIZATION (OPTIONAL)
// ========================================

let db = null;

if (
  CONFIG.FIREBASE_PROJECT_ID &&
  CONFIG.FIREBASE_CLIENT_EMAIL &&
  CONFIG.FIREBASE_PRIVATE_KEY
) {
  try {
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: CONFIG.FIREBASE_PROJECT_ID,
          clientEmail: CONFIG.FIREBASE_CLIENT_EMAIL,
          privateKey: CONFIG.FIREBASE_PRIVATE_KEY,
        }),
      });
    }
    db = admin.firestore();
    console.log('✅ Firebase initialized');
  } catch (error) {
    console.warn('⚠️ Firebase init failed:', error.message);
    console.log('   Running in local-only mode');
  }
} else {
  console.log('⚠️ Firebase not configured - running in local-only mode');
}

// ========================================
// FIRESTORE HELPER FUNCTIONS
// ========================================

async function fsGetOneActiveJob() {
  if (!db) return null;
  try {
    const snapshot = await db
      .collection('jobs')
      .where('status', '==', 'active')
      .limit(1)
      .get();

    if (snapshot.empty) {
      console.log('No active jobs found');
      return null;
    }

    const doc = snapshot.docs[0];
    return { id: doc.id, ...doc.data() };
  } catch (error) {
    console.error('Error fetching active job:', error);
    return null;
  }
}

async function fsUpdateJob(jobId, patch) {
  if (!db) return;
  try {
    await db
      .collection('jobs')
      .doc(jobId)
      .update({
        ...patch,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      });
    console.log(`Job ${jobId} updated`);
  } catch (error) {
    console.error('Error updating job:', error);
  }
}

async function fsAddRun(jobId, ownerUid, startedUtc, notes) {
  if (!db) return null;
  try {
    const docRef = await db.collection('runs').add({
      jobId,
      ownerUid,
      started_utc: admin.firestore.Timestamp.fromDate(startedUtc),
      finished_utc: null,
      result: 'pending',
      notes,
      latency_ms: 0,
      chosen_time: null,
      fallback_level: 0,
    });
    console.log(`Run ${docRef.id} created`);
    return docRef.id;
  } catch (error) {
    console.error('Error adding run:', error);
    return null;
  }
}

async function fsFinishRun(runId, resultObject) {
  if (!db || !runId) return;
  try {
    await db
      .collection('runs')
      .doc(runId)
      .update({
        finished_utc: admin.firestore.FieldValue.serverTimestamp(),
        ...resultObject,
      });
    console.log(`Run ${runId} finished with result: ${resultObject.result}`);
  } catch (error) {
    console.error('Error finishing run:', error);
  }
}

// ========================================
// FIREBASE CLOUD MESSAGING
// ========================================

async function sendPushFCM(title, body, token) {
  if (!token || !CONFIG.FCM_SERVER_KEY) {
    console.log('FCM not configured, skipping notification');
    return;
  }

  try {
    const response = await fetch('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `key=${CONFIG.FCM_SERVER_KEY}`,
      },
      body: JSON.stringify({
        to: token,
        notification: { title, body },
        data: { title, body },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('FCM push failed:', response.status, text);
    } else {
      console.log('FCM push sent');
    }
  } catch (error) {
    console.error('Error sending FCM notification:', error);
  }
}

// ========================================
// PRECISE TIMING FUNCTIONS
// ========================================

async function coarseWaitUntil(targetTime) {
  const now = Date.now();
  const msUntil = targetTime - now - 5000; // Wait until 5 seconds before

  if (msUntil > 0) {
    console.log(`Coarse waiting ${Math.round(msUntil / 1000)}s until T-5s`);
    await new Promise((resolve) => setTimeout(resolve, msUntil));
  }
}

async function spinUntil(targetTime) {
  console.log('Starting spin-wait for millisecond precision...');
  while (Date.now() < targetTime) {
    // Busy-wait for precise timing
    await new Promise((resolve) => setImmediate(resolve));
  }
  console.log('Target time reached!');
}

async function acceptCookies(page) {
  const cookieBtn = page
    .locator('button:has-text("Accept"), button:has-text("I Agree")')
    .first();
  if (await cookieBtn.isVisible().catch(() => false)) {
    await cookieBtn.click().catch(() => {});
  }
}

async function waitForTeeSheet(page, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    await acceptCookies(page);

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
        'button:has-text("Book"), a:has-text("Book"), [role="button"]:has-text("Book")',
      )
      .first();

    if (await dateHeader.isVisible().catch(() => false)) return true;
    if (await anyTime.isVisible().catch(() => false)) return true;
    if (await anyAction.isVisible().catch(() => false)) return true;

    await page.waitForTimeout(300);
  }
  throw new Error('Tee sheet not detected within timeout');
}

async function loginToBRS(page, loginUrl, username, password) {
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await acceptCookies(page);

  const userInput = page.getByPlaceholder(/8 digit GUI|ILGU|username/i).first();
  const passInput = page.getByPlaceholder(/password/i).first();

  await userInput.waitFor({ state: 'visible', timeout: 12000 });
  await userInput.fill(username);
  await passInput.fill(password);

  await page.getByRole('button', { name: /login/i }).first().click();

  // Wait for redirect away from login page or visible tee-sheet nav
  const loggedInSignal = page
    .locator(
      'a[href*="/tee-sheet"], a:has-text("Tee Sheet"), button:has-text("Book")',
    )
    .first();
  await Promise.race([
    loggedInSignal
      .waitFor({ state: 'visible', timeout: 15000 })
      .catch(() => {}),
    page.waitForURL(/(?!.*\/login)/, { timeout: 15000 }).catch(() => {}),
  ]);

  await acceptCookies(page);
}

function teeSheetUrlForDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `https://members.brsgolf.com/galgorm/tee-sheet/1/${y}/${m}/${day}`;
}

async function navigateToTeeSheet(page, date) {
  const baseDate = date instanceof Date ? date : new Date(date);
  const maxHops = 2; // try today and next 2 days if sheet is empty

  for (let i = 0; i <= maxHops; i++) {
    const target = new Date(baseDate);
    target.setDate(baseDate.getDate() + i);
    const url = teeSheetUrlForDate(target);
    console.log(`   → Loading tee sheet ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await acceptCookies(page);

    try {
      await waitForTeeSheet(page, 15000);
      return;
    } catch (e) {
      console.log(`   ⚠️ Tee sheet not ready on hop ${i}: ${e.message}`);
    }
  }

  throw new Error('No tee sheet detected after several day hops');
}

// ========================================
// PLAYER SELECTION & CONFIRMATION HELPER
// ========================================

/**
 * Utility: escape regex special characters
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Fill player dropdowns and confirm booking
 * @param {Page} page - Playwright page
 * @param {string[]} players - List of player names to fill (max 3 for slots 2, 3, 4)
 * @param {number} openSlots - Number of available slots (1-4)
 * @returns {Promise<{filled: string[], skippedReason?: string, confirmationText?: string}>}
 */
async function fillPlayersAndConfirm(page, players = [], openSlots = 3) {
  const result = {
    filled: [],
    skippedReason: null,
    confirmationText: null,
  };

  // Only try to fill as many players as slots permit (max 3 additional players = slots 2, 3, 4)
  const playersToFill = players.slice(0, Math.min(openSlots, 3));

  console.log(`  👥 Attempting to fill ${playersToFill.length} player(s) (${openSlots} slot(s) available)...`);

  // If no additional players needed, skip directly to confirmation
  if (playersToFill.length === 0 && openSlots > 0) {
    console.log(`  ℹ️ Only logged-in user (Player 1) needed. Skipping player selection.`);
    result.skippedReason = 'logged-in-user-only';
  } else if (playersToFill.length === 0) {
    console.log(`  ℹ️ No players provided. Skipping player selection.`);
    result.skippedReason = 'no-players-provided';
  }

  // Attempt to fill each player slot (2, 3, 4)
  for (let i = 0; i < playersToFill.length; i++) {
    const playerName = playersToFill[i];
    const playerNum = i + 2; // Player 2, 3, 4
    let filled = false;

    try {
      console.log(`    🔍 Player ${playerNum}: "${playerName}"...`);

      // Strategy A: Try getByRole('combobox')
      let combobox = null;
      try {
        combobox = page.getByRole('combobox', {
          name: new RegExp(`player\\s*${playerNum}`, 'i'),
        }).first();

        const isVisible = await combobox.isVisible({ timeout: 2000 }).catch(() => false);
        if (isVisible) {
          await combobox.click();
          await page.waitForTimeout(300);

          // Try to select by option role
          const option = page.getByRole('option', {
            name: new RegExp(escapeRegex(playerName), 'i'),
          }).first();

          if ((await option.count()) > 0) {
            await option.click();
            console.log(`    ✅ Player ${playerNum}: ${playerName} (combobox role)`);
            result.filled.push(playerName);
            filled = true;
          } else {
            // Try typing into the combobox to search
            console.log(`    💬 Typing "${playerName}" into search...`);
            await page.keyboard.type(playerName, { delay: 30 });
            await page.waitForTimeout(400);

            const searchResult = page.getByRole('option', {
              name: new RegExp(escapeRegex(playerName), 'i'),
            }).first();

            if ((await searchResult.count()) > 0) {
              await searchResult.click();
              console.log(`    ✅ Player ${playerNum}: ${playerName} (typed search)`);
              result.filled.push(playerName);
              filled = true;
            } else {
              console.log(`    ⚠️ Player ${playerNum}: No match for "${playerName}"`);
            }
          }
        }
      } catch (e) {
        // Strategy A failed, try next
        console.log(`    ℹ️ Strategy A (getByRole combobox) failed: ${e.message.substring(0, 50)}`);
      }

      // Strategy B: Try getByLabel
      if (!filled) {
        try {
          const label = page.getByLabel(new RegExp(`player\\s*${playerNum}`, 'i')).first();
          const isVisible = await label.isVisible({ timeout: 2000 }).catch(() => false);

          if (isVisible) {
            await label.selectOption({ label: playerName }).catch(async () => {
              // If selectOption fails, try clicking and then option selection
              await label.click();
              await page.waitForTimeout(300);
              const option = page.getByRole('option', {
                name: new RegExp(escapeRegex(playerName), 'i'),
              }).first();
              await option.click();
            });
            console.log(`    ✅ Player ${playerNum}: ${playerName} (getByLabel)`);
            result.filled.push(playerName);
            filled = true;
          }
        } catch (e) {
          console.log(`    ℹ️ Strategy B (getByLabel) failed: ${e.message.substring(0, 50)}`);
        }
      }

      // Strategy C: Find container and search within
      if (!filled) {
        try {
          const containers = page.locator('div, fieldset, section');
          const containerCount = await containers.count();

          for (let c = 0; c < containerCount && !filled; c++) {
            const container = containers.nth(c);
            const text = await container.innerText().catch(() => '');

            if (text.includes(`Player ${playerNum}`) || text.includes(`player ${playerNum}`)) {
              const comboboxInContainer = container.locator('[role="combobox"]').first();

              if ((await comboboxInContainer.count()) > 0) {
                await comboboxInContainer.click();
                await page.waitForTimeout(300);

                const option = page.getByRole('option', {
                  name: new RegExp(escapeRegex(playerName), 'i'),
                }).first();

                if ((await option.count()) > 0) {
                  await option.click();
                  console.log(`    ✅ Player ${playerNum}: ${playerName} (container search)`);
                  result.filled.push(playerName);
                  filled = true;
                  break;
                }
              }
            }
          }
        } catch (e) {
          console.log(`    ℹ️ Strategy C (container search) failed: ${e.message.substring(0, 50)}`);
        }
      }

      if (!filled) {
        console.log(`    ⚠️ Player ${playerNum} field not found or player not selectable`);
        // Do not fail the booking; this is expected when openSlots < required players
      }
    } catch (error) {
      console.log(`    ❌ Error filling Player ${playerNum}: ${error.message}`);
    }
  }

  // Now click Confirm button
  console.log(`  🎯 Clicking Confirm button...`);

  try {
    // Strategy 1: getByRole button with confirm text
    let confirmBtn = page.getByRole('button', {
      name: /confirm|book|complete|finish|final|create.*booking|proceed/i,
    }).first();

    let btnVisible = await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false);

    // Strategy 2: Fallback locators
    if (!btnVisible) {
      confirmBtn = page.locator('button:has-text("Confirm"), button:has-text("Book"), button:has-text("Complete")').first();
      btnVisible = await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false);
    }

    if (btnVisible) {
      await confirmBtn.click({ timeout: 5000 });
      console.log(`    ✅ Confirm button clicked`);

      // Wait for navigation/response
      await page.waitForTimeout(2000);

      // Verify booking success
      const successPatterns = [
        /booking.*confirmed/i,
        /successfully.*booked/i,
        /confirmation/i,
        /reference.*number/i,
        /booking.*complete/i,
        /thank\s+you/i,
        /your.*booking/i,
      ];

      for (const pattern of successPatterns) {
        try {
          const element = page.getByText(pattern).first();
          const isVisible = await element.isVisible({ timeout: 2000 }).catch(() => false);

          if (isVisible) {
            const confirmText = await element.textContent().catch(() => '');
            console.log(`    ✅ Success detected: "${confirmText}"`);
            result.confirmationText = confirmText;
            return result;
          }
        } catch (e) {
          // Continue checking other patterns
        }
      }

      // Fallback: Check if we're now on a bookings list page
      try {
        const bookingsHeading = page.getByText(/my.*bookings|your.*bookings|booked.*tee/i).first();
        if ((await bookingsHeading.count()) > 0) {
          const headingText = await bookingsHeading.textContent().catch(() => '');
          console.log(`    ✅ Success detected (bookings page): "${headingText}"`);
          result.confirmationText = headingText;
          return result;
        }
      } catch (e) {
        // Not a bookings page
      }

      console.log(`    ⚠️ No success confirmation message detected, but confirm clicked`);
      result.confirmationText = 'confirm-clicked-no-confirmation-text';
      return result;
    } else {
      console.log(`    ❌ Confirm button not found (timeout)`);
      result.confirmationText = 'confirm-button-not-found';
      return result;
    }
  } catch (error) {
    console.log(`    ❌ Error clicking confirm: ${error.message}`);
    result.confirmationText = `error: ${error.message}`;
    return result;
  }
}

async function tryBookTime(page, time, players = [], openSlots = 3) {
  // Wait for tee sheet to be fully loaded
  console.log(`  ⏳ Waiting for tee sheet to load...`);
  await page.waitForSelector('tr', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2000);

  // Find all table rows
  const rows = page.locator('tr');
  const rowCount = await rows.count();

  console.log(`  🔍 Scanning ${rowCount} rows for time ${time}...`);

  let bookButton = null;

  // Scan rows to find the one with the matching time
  for (let i = 0; i < rowCount; i++) {
    const row = rows.nth(i);
    const rowText = await row.innerText().catch(() => '');

    // Check if this row contains the target time
    if (rowText.includes(time)) {
      console.log(`  ✅ Found row with time ${time}`);

      // Look for Book button in this row
      const bookBtn = row
        .locator(':is(button,a,[role="button"])')
        .filter({ hasText: /\bbook(\s+now)?\b/i })
        .first();

      if ((await bookBtn.count()) > 0) {
        bookButton = bookBtn;
        break;
      }
    }
  }

  if (!bookButton) {
    console.log(`  ⚠️ No booking button found for ${time}`);
    return { booked: false, error: 'no-booking-button-found' };
  }

  console.log(`  📍 Clicking booking button for ${time}...`);
  await bookButton.click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(2000); // Wait for booking form to load

  // Add dialog handler to avoid freezes
  page.on('dialog', (dialog) => dialog.accept());

  // Call the unified player selection and confirmation helper
  const confirmResult = await fillPlayersAndConfirm(page, players, openSlots);

  // Return detailed result
  return {
    booked: confirmResult.confirmationText !== null && confirmResult.confirmationText !== 'confirm-button-not-found',
    playersFilled: confirmResult.filled,
    playersRequested: players.slice(0, Math.min(openSlots, 3)),
    confirmationText: confirmResult.confirmationText,
    skippedReason: confirmResult.skippedReason,
    error: confirmResult.confirmationText === 'confirm-button-not-found' ? 'confirm-button-not-found' : null,
  };
}

// Compute the next release window in UTC based on a weekly release day/time
function computeNextFireUTC(
  releaseDay,
  releaseTimeLocal,
  tz = CONFIG.TZ_LONDON,
) {
  const dayMap = {
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
    sunday: 7,
  };

  const normalizedDay = (releaseDay || '').toString().trim().toLowerCase();
  const targetWeekday = dayMap[normalizedDay];
  if (!targetWeekday) {
    throw new Error(`Invalid release day: ${releaseDay}`);
  }

  const [hh, mm] = (releaseTimeLocal || '00:00').split(':');
  const hour = Number.parseInt(hh, 10);
  const minute = Number.parseInt(mm || '0', 10);
  if (Number.isNaN(hour) || Number.isNaN(minute)) {
    throw new Error(`Invalid release time: ${releaseTimeLocal}`);
  }

  const now = DateTime.now().setZone(tz);
  let target = now.set({ hour, minute, second: 0, millisecond: 0 });

  const daysAhead = (targetWeekday - now.weekday + 7) % 7;
  if (daysAhead === 0 && target <= now) {
    target = target.plus({ days: 7 });
  } else if (daysAhead > 0) {
    target = target.plus({ days: daysAhead });
  }

  return target.toUTC().toJSDate();
}

// ========================================
// BOOKING AUTOMATION LOGIC
// ========================================

function normalizeTimeToHHMM(str) {
  if (!str) return null;
  const m = str.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

function parseTimeToMinutes(str) {
  const norm = normalizeTimeToHHMM(str);
  if (!norm) return null;
  const [hh, mm] = norm.split(':').map((v) => Number.parseInt(v, 10));
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  return hh * 60 + mm;
}

async function clickFirstMatchingBookingLink(
  page,
  preferredTimes = [],
  windowMinutes = 0,
) {
  const prefs = Array.isArray(preferredTimes)
    ? preferredTimes.filter(Boolean).map((t) => normalizeTimeToHHMM(t))
    : [];
  if (!prefs.length) return { clicked: false, reason: 'no-preferred' };

  const primaryMinutes = parseTimeToMinutes(prefs[0]);
  const windowMins = Number(windowMinutes) || 0;

  const locator = page.locator('a[href*="/bookings/book"]');
  const count = await locator.count();
  for (let i = 0; i < count; i++) {
    const link = locator.nth(i);
    const row = link.locator('xpath=ancestor::tr[1]').first();
    const rowText = await row.innerText().catch(() => '');
    const match = rowText.match(/\b(\d{1,2}:\d{2})\b/);
    const rowTime = normalizeTimeToHHMM(match ? match[1] : null);
    const rowMinutes = parseTimeToMinutes(rowTime);

    const matchPreferred = rowTime && prefs.includes(rowTime);
    const matchWindow =
      !matchPreferred &&
      windowMins > 0 &&
      primaryMinutes !== null &&
      rowMinutes !== null &&
      Math.abs(rowMinutes - primaryMinutes) <= windowMins;

    if (matchPreferred || matchWindow) {
      await link.click({ timeout: 2000 }).catch(() => {});
      return { clicked: true, time: rowTime || prefs[0], matchedWindow: matchWindow };
    }
  }

  return { clicked: false, reason: 'no-matching-link' };
}

export async function runBooking(config) {
  const {
    jobId,
    ownerUid,
    loginUrl,
    username,
    password,
    preferredTimes,
    targetFireTime,
    pushToken,
    targetPlayDate,
    players = [],
    slotsData = [],  // Array of {time, openSlots, status}
    warmPage = null,
    useReleaseObserver = false,
    windowMinutes = 0,
    auditRunId: providedAuditRunId = null,
    dryRun = true,
  } = config;
  // auditRunId already declared above

  if (!username || !password) {
    throw new Error('Missing BRS credentials for booking run');
  }

  const fireMs =
    typeof targetFireTime === 'number' ? targetFireTime : +targetFireTime;
  const fireIso = new Date(fireMs).toISOString();

  let browser;
  let page;
  let isWarm = false;
  const auditRunId = providedAuditRunId || crypto.randomUUID();
  const startTime = Date.now();
  const teeDate = targetPlayDate ? new Date(targetPlayDate) : new Date();
  const notes = [];
  let bookedTime = null;
  let fallbackLevel = 0;
  let observerDetected = false;
  let observerMatched = false;
  let observerClickDeltaMs = null;
  let observerDetectDeltaMs = null;
  let runId = null;

  try {
    console.log('='.repeat(60));
    console.log('FAIRWAY SNIPER - BOOKING AGENT STARTED');
    console.log('='.repeat(60));
    console.log(`Job ID: ${jobId}`);
    console.log(`Target fire time: ${fireIso}`);
    console.log(`Preferred times: ${preferredTimes.join(', ')}`);
    appendAudit({
      type: 'run_start',
      runId: auditRunId,
      mode: useReleaseObserver ? 'release-snipe' : 'normal',
      targetDate: targetPlayDate,
      preferredTimes,
      windowMinutes,
      ts: Date.now(),
    });

    // Create run record
    runId = await fsAddRun(
      jobId,
      ownerUid,
      new Date(),
      'Booking attempt started',
    );

    if (warmPage) {
      isWarm = true;
      page = warmPage;
      browser = page.context();
      console.log('[WARM] Using preloaded session/page; skipping login + navigation');
      appendAudit({ type: 'warm_used', runId: auditRunId, used: true, ts: Date.now() });
    } else {
      // Launch browser
      console.log('\n[1/5] Launching headless browser...');
      browser = await chromium.launch({
        headless: true,
        args: ['--disable-blink-features=AutomationControlled'],
      });

      const context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
      });

      page = await context.newPage();

      // Navigate and login
      console.log(`\n[2/5] Navigating to ${loginUrl}...`);
      await loginToBRS(page, loginUrl, username, password);

      console.log(
        `\n[3/5] Loading tee sheet for ${teeDate.toISOString().slice(0, 10)}...`,
      );
      await navigateToTeeSheet(page, teeDate);
    }

    // Coarse wait until near target time
    appendAudit({ type: 'coarse_wait_start', runId: auditRunId, ts: Date.now(), fireMs });
    await coarseWaitUntil(fireMs);
    appendAudit({ type: 'coarse_wait_end', runId: auditRunId, ts: Date.now() });

    // Spin-wait for precise timing
    console.log('\n[4/5] Executing precise timing...');
    appendAudit({ type: 'spin_start', runId: auditRunId, ts: Date.now() });
    await spinUntil(fireMs);
    appendAudit({ type: 'spin_end', runId: auditRunId, ts: Date.now() });

    // Release-night fast path using MutationObserver
    if (useReleaseObserver) {
      console.log('[SNIPER] Release watcher (MutationObserver) armed...');
      appendAudit({ type: 'observer_armed', runId: auditRunId, ts: Date.now() });
      const releaseResult = await warmSession.waitForBookingReleaseObserver(
        page,
        2000,
      ).catch(() => ({ found: false }));

      if (releaseResult && releaseResult.found) {
        const detectedAt = releaseResult.time || Date.now();
        const delta = detectedAt - fireMs;
        console.log(
          `[FIRE] Booking link detected via observer; delta ${delta}ms`,
        );
        observerDetected = true;
        observerDetectDeltaMs = delta;
        appendAudit({
          type: 'observer_detected',
          runId: auditRunId,
          ts: Date.now(),
          detectDeltaMs: delta,
          slotTime: releaseResult.slotTime || null,
        });
        if (dryRun) {
          appendAudit({ type: 'dry_run_enabled', runId: auditRunId, ts: Date.now() });
          // Simulate clickFirstMatchingBookingLink but do not click
          const prefs = Array.isArray(preferredTimes)
            ? preferredTimes.filter(Boolean).map((t) => normalizeTimeToHHMM(t))
            : [];
          let matchTime = null;
          let matchedWindow = false;
          if (prefs.length) {
            const primaryMinutes = parseTimeToMinutes(prefs[0]);
            const windowMins = Number(windowMinutes) || 0;
            const locator = page.locator('a[href*="/bookings/book"]');
            const count = await locator.count();
            for (let i = 0; i < count; i++) {
              const link = locator.nth(i);
              const row = link.locator('xpath=ancestor::tr[1]').first();
              const rowText = await row.innerText().catch(() => '');
              const match = rowText.match(/\b(\d{1,2}:\d{2})\b/);
              const rowTime = normalizeTimeToHHMM(match ? match[1] : null);
              const rowMinutes = parseTimeToMinutes(rowTime);
              const matchPreferred = rowTime && prefs.includes(rowTime);
              const matchWin =
                !matchPreferred &&
                windowMins > 0 &&
                primaryMinutes !== null &&
                rowMinutes !== null &&
                Math.abs(rowMinutes - primaryMinutes) <= windowMins;
              if (matchPreferred || matchWin) {
                matchTime = rowTime || prefs[0];
                matchedWindow = matchWin;
                break;
              }
            }
          }
          if (matchTime) {
            observerMatched = true;
            observerClickDeltaMs = Date.now() - fireMs;
            appendAudit({
              type: 'dry_run_match_found',
              runId: auditRunId,
              ts: Date.now(),
              matched: true,
              matchedTime: matchTime,
              matchedWindow: matchedWindow,
              clickDeltaMs: Date.now() - fireMs,
            });
            notes.push(`DRY RUN: Would have booked ${matchTime}`);
          } else {
            appendAudit({
              type: 'dry_run_match_found',
              runId: auditRunId,
              ts: Date.now(),
              matched: false,
            });
            notes.push('DRY RUN: No matching booking link found');
          }
          appendAudit({ type: 'dry_run_complete', runId: auditRunId, ts: Date.now() });
          return {
            success: true,
            result: 'dry_run',
            bookedTime: null,
            fallbackLevel: 0,
            latencyMs: Date.now() - startTime,
            notes: notes.join(' | '),
            playersRequested: players,
            runId,
            auditRunId,
            observerDetected,
            observerMatched,
            observerClickDeltaMs,
            observerDetectDeltaMs,
          };
        } else {
          const clickResult = await clickFirstMatchingBookingLink(
            page,
            preferredTimes,
            windowMinutes,
          );
          if (clickResult.clicked) {
            observerMatched = true;
            observerClickDeltaMs = Date.now() - fireMs;
            appendAudit({
              type: 'observer_click_attempt',
              runId: auditRunId,
              ts: Date.now(),
              matched: true,
              matchedTime: clickResult.time,
              matchedWindow: clickResult.matchedWindow || false,
              clickDeltaMs: Date.now() - fireMs,
            });
            const openSlots =
              (slotsData && slotsData[0]?.openSlots) || 3;
            await page.waitForTimeout(1500);
            const confirmResult = await fillPlayersAndConfirm(
              page,
              players,
              openSlots,
            );
            const releaseBooked =
              confirmResult.confirmationText !== null &&
              confirmResult.confirmationText !== 'confirm-button-not-found';
            if (releaseBooked) {
              bookedTime = clickResult.time || releaseResult.slotTime || 'release';
              fallbackLevel = 0;
              notes.push(
                `Release-night booking; delta ${delta}ms; confirmation: ${confirmResult.confirmationText}`,
              );
            } else {
              notes.push(
                `Release-night click observed but confirmation missing: ${confirmResult.confirmationText}`,
              );
            }
          } else {
            appendAudit({
              type: 'observer_click_attempt',
              runId: auditRunId,
              ts: Date.now(),
              matched: false,
              detectDeltaMs: Date.now() - fireMs,
            });
            console.log(
              '[SNIPER] Observer found link but no preferred time match; falling back to scan',
            );
          }
        }
      } else {
        console.log('[SNIPER] Release watcher timeout — falling back to scan');
      }
    }

    // BOOKING EXECUTION
    console.log('\n[5/5] 🎯 ATTEMPTING BOOKING NOW!');
    const bookingStartTime = Date.now();
    appendAudit({ type: 'fallback_scan_start', runId: auditRunId, ts: bookingStartTime });

    if (dryRun) {
      notes.push('DRY RUN: Skipping all booking attempts in fallback scan');
      appendAudit({ type: 'dry_run_fallback_skipped', runId: auditRunId, ts: Date.now() });
    } else {
      // Try each preferred time in order (skip if already booked via release observer)
      if (!bookedTime) {
        for (const [index, time] of preferredTimes.entries()) {
          try {
            console.log(`Trying time slot: ${time}`);
            // Find openSlots for this time from slotsData
            const slotInfo = slotsData.find(s => s.time === time);
            const openSlots = slotInfo ? slotInfo.openSlots : 3; // default to 3 if not found
            const bookingResult = await tryBookTime(page, time, players, openSlots);
            if (bookingResult && bookingResult.booked) {
              bookedTime = time;
              fallbackLevel = index;
              notes.push(`Booked ${time}; Players filled: ${bookingResult.playersFilled?.join(', ') || 'none'}; Confirmation: ${bookingResult.confirmationText}`);
              break;
            } else if (bookingResult) {
              const msg = `Could not complete booking for ${time}: ${bookingResult.error || bookingResult.confirmationText}`;
              console.log(msg);
              notes.push(msg);
            }
          } catch (error) {
            const msg = `Failed to book ${time}: ${error.message}`;
            console.error(msg);
            notes.push(msg);
          }
        }
      }
    }
    appendAudit({ type: 'fallback_scan_end', runId: auditRunId, ts: Date.now() });

    const latencyMs = Date.now() - bookingStartTime;

    // Determine result
    let result;
    let notificationTitle;
    let notificationBody;

    if (bookedTime) {
      if (fallbackLevel === 0) {
        result = 'success';
        notificationTitle = '✅ Tee Time Booked!';
        notificationBody = `Successfully booked ${bookedTime}`;
      } else {
        result = 'fallback';
        notificationTitle = '☑️ Fallback Slot Booked';
        notificationBody = `Booked ${bookedTime} (fallback option ${
          fallbackLevel + 1
        })`;
      }
    } else {
      result = 'failed';
      notificationTitle = '❌ Booking Failed';
      notificationBody = 'No preferred slots were available';
    }

    // Save results
    await fsFinishRun(runId, {
      result,
      notes: `Completed in ${latencyMs}ms; ${notes.join(' | ')}`,
      latency_ms: latencyMs,
      chosen_time: bookedTime,
      fallback_level: fallbackLevel,
    });
    appendAudit({
      type: 'booking_result',
      runId: auditRunId,
      ts: Date.now(),
      success: result === 'success' || result === 'fallback',
      bookedTime,
      fallbackLevel,
      latencyMs,
    });

    // Send notification
    await sendPushFCM(notificationTitle, notificationBody, pushToken);

    console.log('\n' + '='.repeat(60));
    console.log(`RESULT: ${result.toUpperCase()}`);
    if (bookedTime) console.log(`BOOKED TIME: ${bookedTime}`);
    console.log(`LATENCY: ${latencyMs}ms`);
    console.log(`NOTES: ${notes.join(' | ')}`);
    console.log('='.repeat(60));

    if (browser && !isWarm) {
      await browser.close();
    }

    return {
      success: result === 'success' || result === 'fallback',
      result,
      bookedTime,
      fallbackLevel,
      latencyMs,
      notes: notes.join(' | '),
      playersRequested: players,
      runId,
      auditRunId,
      observerDetected,
      observerMatched,
      observerClickDeltaMs,
      observerDetectDeltaMs,
    };
  } catch (error) {
    console.error('\n❌ ERROR:', error);

    if (runId) {
      await fsFinishRun(runId, {
        result: 'error',
        notes: error.message,
        latency_ms: Date.now() - startTime,
      });
    }

    if (pushToken) {
      await sendPushFCM('⚠️ Booking Error', error.message, pushToken);
    }

    if (browser && !isWarm) await browser.close();

    appendAudit({
      type: 'run_error',
      runId: auditRunId,
      ts: Date.now(),
      message: error.message,
      stack: (error.stack || '').split('\n')[0],
    });

    return {
      success: false,
      error: error.message,
      runId,
      auditRunId,
      observerDetected,
      observerMatched,
      observerClickDeltaMs,
      observerDetectDeltaMs,
    };
  }
}

// ========================================
// MAIN EXECUTION
// ========================================

async function main() {
  try {
    console.log('Fairway Sniper Agent starting...');

    if (CONFIG.DRY_RUN) {
      console.log('\n🧪 DRY RUN MODE - Testing without actual booking\n');
    }

    // Fetch one active job
    const job = await fsGetOneActiveJob();

    if (!job) {
      console.log('No active jobs to process. Exiting.');
      return;
    }

    if (!job.brs_email || !job.brs_password) {
      throw new Error(
        'Active job is missing brs_email/brs_password; cannot proceed',
      );
    }

    const targetPlayDate = job.target_play_date?.toDate
      ? job.target_play_date.toDate()
      : job.target_play_date || null;

    // Compute next fire time
    const nextFireTime = computeNextFireUTC(
      job.release_day,
      job.release_time_local,
      job.tz,
    );

    console.log(`Next booking window: ${nextFireTime.toISOString()}`);

    // Update job with next fire time
    await fsUpdateJob(job.id, {
      next_fire_time_utc: admin.firestore.Timestamp.fromDate(nextFireTime),
    });

    // Determine when to start (90 seconds before release)
    const startTime = nextFireTime.getTime() - 90000;
    const now = Date.now();
    const msUntilStart = startTime - now;

    if (msUntilStart > 0) {
      console.log(
        `Waiting ${Math.round(msUntilStart / 1000)}s until execution...`,
      );
      await new Promise((resolve) => setTimeout(resolve, msUntilStart));
    }

    // Execute booking
    const result = await runBooking({
      jobId: job.id,
      ownerUid: job.ownerUid,
      loginUrl: CONFIG.CLUB_LOGIN_URL,
      username: job.brs_email || CONFIG.BRS_USERNAME,
      password: job.brs_password || CONFIG.BRS_PASSWORD,
      preferredTimes: job.preferred_times,
      targetFireTime: nextFireTime.getTime(),
      pushToken: job.push_token,
      targetPlayDate,
    });

    console.log('\nAgent execution complete.');
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}


/**
 * Fetches available tee times for a specific date from BRS Golf
 * Uses Playwright to scrape the actual booking page
 */
async function fetchAvailableTeeTimesFromBRS(date, username, password) {
  let browser;

  try {
    const dateStr = date.toISOString().split('T')[0];
    console.log(`Fetching tee times for ${dateStr}...`);

    browser = await chromium.launch({
      headless: true,
      args: ['--disable-blink-features=AutomationControlled'],
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      viewport: { width: 1280, height: 720 },
    });

    const page = await context.newPage();

    // Navigate to tee sheet for target date
    const [y, m, d] = dateStr.split('-');
    const teeSheetUrl = `https://members.brsgolf.com/galgorm/tee-sheet/1/${y}/${m}/${d}`;
    await page.goto(teeSheetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });

    // Accept cookies if shown
    const cookieBtn = page
      .locator('button:has-text("Accept"), button:has-text("I Agree")')
      .first();
    if (await cookieBtn.isVisible().catch(() => false)) {
      await cookieBtn.click().catch(() => {});
    }

    // If login required, perform login
    const loginIndicator = page
      .locator('text=/Member Login|Enter your 8 digit GUI|Username/i')
      .first();
    if (await loginIndicator.isVisible().catch(() => false)) {
      console.log('  🔐 Logging in for tee sheet...');
      await page
        .getByPlaceholder(/8 digit GUI|ILGU|username/i)
        .first()
        .fill(username);
      await page
        .getByPlaceholder(/password/i)
        .first()
        .fill(password);
      await page.getByRole('button', { name: /login/i }).first().click();
      await page.waitForTimeout(3000);
      await page.goto(teeSheetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });
      const cookie2 = page
        .locator('button:has-text("Accept"), button:has-text("I Agree")')
        .first();
      if (await cookie2.isVisible().catch(() => false)) {
        await cookie2.click().catch(() => {});
      }
    }

    // Wait for booking links to appear
    const start = Date.now();
    const pollTimeout = 20000;
    let count = 0;
    while (Date.now() - start < pollTimeout) {
      count = await page.locator('a[href*="/bookings/book/"]').count();
      if (count > 0) break;
      await page.waitForTimeout(300);
    }
    console.log(`  ✅ Found ${count} booking links`);

    // Extract time + capacity heuristics from the booking rows
    const slots = await page.$$eval('a[href*="/bookings/book/"]', (anchors) => {
      const seen = new Set();
      const out = [];

      const guessBookedCount = (row) => {
        if (!row) return 0;

        // New layout: booker name appears separately (left), actual players appear in player cells (right)
        // We need to count ONLY the players, not the booker label
        const cells = Array.from(row.querySelectorAll('td'));

        // Try to identify player cells vs booker/info cells
        // Player cells typically contain multiple names or a single player name
        // Look for cells with actual player content (not time, not buttons)
        const playerCells = cells.filter((td) => {
          const text = (td.innerText || '').trim();
          // Skip empty, time cells, button cells
          if (!text || text.length < 3) return false;
          if (/^\d{1,2}:\d{2}/.test(text)) return false;
          if (/book now|add|waiting|view/i.test(text)) return false;
          return true;
        });

        // Extract all name-like tokens from player cells only
        const allText = playerCells.map((td) => td.innerText || '').join('\n');

        const tokens = allText
          .split(/\n+/)
          .map((t) => t.trim())
          .filter(Boolean);

        const seen = new Set();
        const nameTokens = tokens.filter((t) => {
          const lower = t.toLowerCase();
          // Skip obvious non-name content
          if (!/[a-z]/i.test(t)) return false;
          if (/\d{1,2}:\d{2}/.test(lower)) return false; // times
          if (
            /book|booking|available|waiting|waitlist|wait list|open|holes|format|course|tee|sheet|buggy|buggies|price|rate|member|login|book now|member booked/i.test(
              lower,
            )
          )
            return false;
          if (/£|€|\$/.test(t)) return false;
          if (/^\d+$/.test(t)) return false;

          // Clean punctuation/digits and ensure some letters remain
          const cleaned = t.replace(/[^a-zA-Z'\-\s]/g, '').trim();
          if (cleaned.length < 2) return false;
          if (!/[a-zA-Z]{2}/.test(cleaned)) return false;

          const key = cleaned.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        // Count unique player names found; this is the booked count
        return Math.min(4, Math.max(0, nameTokens.length));
      };

      anchors.forEach((a) => {
        const href = a.getAttribute('href') || '';
        const match = href.match(/\/(\d{4})(?:[^\d]|$)/);
        if (!match) return;

        const hhmm = match[1];
        const hh = hhmm.slice(0, 2);
        const mm = hhmm.slice(2, 4);
        const time = `${hh}:${mm}`;
        if (seen.has(time)) return;

        // Find closest row container
        let row = a.closest('tr');
        if (!row) row = a.closest('td')?.parentElement;
        if (!row) row = a.parentElement;

        const totalSlots = 4; // BRS tee time capacity is typically 4
        const bookedCount = guessBookedCount(row);
        const openSlots = Math.max(0, totalSlots - bookedCount);

        out.push({
          time,
          status: openSlots > 0 ? 'bookable' : 'full',
          openSlots,
          totalSlots,
        });

        seen.add(time);
      });

      return out;
    });

    await browser.close();

    const sorted = slots.sort((a, b) => a.time.localeCompare(b.time));
    console.log(
      `  ✅ Found ${sorted.length} available tee times (with capacity hints)`,
    );
    return {
      times: sorted.map((s) => s.time),
      slots: sorted,
    };
  } catch (error) {
    console.error('Error fetching tee times:', error);
    if (browser) await browser.close();
    throw error;
  }
}

// HTTP endpoint to fetch tee times
app.post('/api/fetch-tee-times', async (req, res) => {
  try {
    const { date, username, password } = req.body;

    if (!date) {
      return res.status(400).json({ error: 'Date is required' });
    }

    if (!username || !password) {
      return res.status(400).json({ error: 'BRS credentials are required' });
    }

    const targetDate = new Date(date);
    const { times, slots } = await fetchAvailableTeeTimesFromBRS(
      targetDate,
      username,
      password,
    );

    res.json({ success: true, times, slots });
  } catch (error) {
    console.error('Fetch tee times error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch tee times',
    });
  }
});

// Fetch tee times over a range of days
// Request body: { startDate: ISO string, days: number, username, password }
app.post('/api/fetch-tee-times-range', async (req, res) => {
  try {
    const { startDate, days, username, password } = req.body;
    if (!startDate || !days || !username || !password) {
      return res.status(400).json({
        success: false,
        error: 'startDate, days, username, password are required',
      });
    }

    const start = new Date(startDate);
    if (Number.isNaN(start.getTime())) {
      return res
        .status(400)
        .json({ success: false, error: 'Invalid startDate' });
    }

    const results = [];
    for (let i = 0; i < Number(days); i++) {
      const targetDate = new Date(start);
      targetDate.setDate(start.getDate() + i);
      const dayStr = targetDate.toISOString().slice(0, 10);
      const { times, slots } = await fetchAvailableTeeTimesFromBRS(
        targetDate,
        username,
        password,
      );
      results.push({ date: dayStr, times, slots });
    }

    res.json({
      success: true,
      days: results,
      count: results.length,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('  ❌ Error fetching tee times range:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch tee times range',
    });
  }
});

// Fetch player directory endpoint (scrapes player names from booking form)
app.post('/api/brs/fetch-player-directory', async (req, res) => {
  try {
    const { userId, username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'BRS credentials are required' });
    }

    console.log(`\n🔍 Fetching player directory for user ${userId}...`);

    const browser = await chromium.launch({ headless: true });

    // DON'T use stored session for player directory - need fresh login to get correct Player 1 name
    let contextOptions = {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      viewport: { width: 1920, height: 1080 },
    };

    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();

    // Go to tee sheet for today
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    const teeSheetUrl = `https://members.brsgolf.com/galgorm/tee-sheet/1/${y}/${m}/${d}`;

    await page.goto(teeSheetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Accept cookies if present
    const cookie = page
      .locator('button:has-text("Accept"), button:has-text("I Agree")')
      .first();
    if (await cookie.isVisible().catch(() => false)) {
      console.log('  🍪 Accepting cookies...');
      await cookie.click().catch(() => {});
    }

    // Login if needed (reuse existing login logic)
    const loginIndicator = page
      .locator('text=/Member Login|Enter your 8 digit GUI|Username/i')
      .first();
    if (await loginIndicator.isVisible().catch(() => false)) {
      console.log('  🔐 Logging in...');
      await page
        .getByPlaceholder(/8 digit GUI|ILGU|username/i)
        .first()
        .fill(username);
      await page
        .getByPlaceholder(/password/i)
        .first()
        .fill(password);
      await page.getByRole('button', { name: /login/i }).first().click();
      await page.waitForTimeout(3000);
      await page.goto(teeSheetUrl, { waitUntil: 'domcontentloaded' });
      // Accept cookies again after login
      const cookie2 = page
        .locator('button:has-text("Accept"), button:has-text("I Agree")')
        .first();
      if (await cookie2.isVisible().catch(() => false)) {
        await cookie2.click().catch(() => {});
      }
    }

    // Wait for tee sheet UI with polling (like working function)
    console.log('  Waiting for tee sheet to load...');

    // Try clicking Detail button if it exists (might show hidden rows)
    const detailBtn = page
      .locator('button#detail, button:has-text("Detail")')
      .first();
    if (await detailBtn.isVisible().catch(() => false)) {
      console.log('  📋 Clicking Detail button...');
      await detailBtn.click();
      await page.waitForTimeout(1000);
    }

    const maxDayHops = 6; // search up to 6 days ahead if no bookable slots today
    let bookHref = null;
    for (let dayOffset = 0; dayOffset <= maxDayHops && !bookHref; dayOffset++) {
      if (dayOffset > 0) {
        const target = new Date();
        target.setDate(target.getDate() + dayOffset);
        const y2 = target.getFullYear();
        const m2 = String(target.getMonth() + 1).padStart(2, '0');
        const d2 = String(target.getDate()).padStart(2, '0');
        const hopUrl = `https://members.brsgolf.com/galgorm/tee-sheet/1/${y2}/${m2}/${d2}`;
        console.log(`  🔁 No book links yet; hopping to ${hopUrl}`);
        await page.goto(hopUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 45000,
        });
        const cookieHop = page
          .locator('button:has-text("Accept"), button:has-text("I Agree")')
          .first();
        if (await cookieHop.isVisible().catch(() => false)) {
          await cookieHop.click().catch(() => {});
        }
      }

      // Try a direct waitForSelector first (more reliable than polling getAttribute)
      try {
        const locator = await page.waitForSelector(
          'a[href*="/bookings/book/"]',
          { timeout: 45000 },
        );
        bookHref = await locator.getAttribute('href');
        if (bookHref) {
          const count = await page
            .locator('a[href*="/bookings/book/"]')
            .count();
          console.log(
            `  ✅ Found ${count} Book buttons (day offset ${dayOffset})`,
          );
          break;
        }
      } catch (e) {
        // fallback to a short poll before hopping days
      }

      const start = Date.now();
      const pollTimeout = 8000; // short poll per day before hopping
      while (Date.now() - start < pollTimeout && !bookHref) {
        const locator = page.locator('a[href*="/bookings/book/"]').first();
        const count = await page.locator('a[href*="/bookings/book/"]').count();
        if (count > 0) {
          bookHref = await locator.getAttribute('href');
          console.log(
            `  ✅ Found ${count} Book buttons (day offset ${dayOffset})`,
          );
          break;
        }
        await page.waitForTimeout(200);
      }
    }

    // Find and click FIRST Book button (use JavaScript to click hidden element)
    console.log('  🔍 Looking for Book button...');
    if (!bookHref) {
      throw new Error('No Book button found after checking multiple days');
    }
    console.log(`  ✅ Found booking URL: ${bookHref}`);

    // Navigate to the booking page directly
    const bookUrl = new URL(bookHref, 'https://members.brsgolf.com/galgorm');
    await page.goto(bookUrl.href, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
    console.log('  ✅ Navigated to booking form');

    // Wait for booking form to load
    await page.waitForTimeout(2000);

    // Extract players from Player 3 select dropdown (Player 1/2 may be disabled if existing booking)
    console.log('  🔍 Extracting players from form...');
    let player2Selector = 'select#member_booking_form_player_3';

    // Wait for the select to exist
    await page.waitForSelector(player2Selector, { timeout: 15000 });

    // Try to open Select2 dropdown by clicking the container
    const select2Container = page
      .locator('.select2-container[aria-owns*="player_3"]')
      .first();
    const isVisible = await select2Container.isVisible().catch(() => false);
    if (isVisible) {
      console.log(
        '  🎯 Found Select2 container for Player 3, opening dropdown...',
      );
      await select2Container.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(2000);

      // Now try to find and type in search to trigger loading
      const searchInput = page
        .locator(
          '.select2-search__field, input[aria-label*="search"], input[role="combobox"]',
        )
        .first();
      const searchVisible = await searchInput.isVisible().catch(() => false);
      if (searchVisible) {
        console.log('  ⌨️  Found search input, typing to load options...');
        await searchInput.focus();
        await page.waitForTimeout(500);
        // Type to trigger search/load, use a common character
        await searchInput.type('a', { delay: 100 }).catch(() => {});
        await page.waitForTimeout(2000);
      }
    } else {
      console.log(
        '  📌 Select2 container not found, trying direct select click...',
      );
      const player2Locator = page.locator(player2Selector);
      await player2Locator.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(2000);
    }

    // SAVE PAGE HTML FOR DEBUGGING
    const pageHtml = await page.content();
    const fs = await import('fs');
    const path = await import('path');
    const outputDir = path.join(process.cwd(), 'output');
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .slice(0, -5);
    const debugFile = path.join(outputDir, `booking-form-${timestamp}.html`);
    await fs.promises.mkdir(outputDir, { recursive: true }).catch(() => {});
    await fs.promises.writeFile(debugFile, pageHtml, 'utf8').catch(() => {});
    console.log(
      `  💾 Saved page HTML to agent/output/booking-form-${timestamp}.html`,
    );

    // Extract from Select2 rendered dropdown OR from hidden select fallback
    const categorizedPlayers = await page.evaluate(() => {
      const select = document.querySelector(
        'select#member_booking_form_player_3',
      );
      if (!select) {
        return {
          categories: [],
          currentMemberId: null,
          currentUserName: null,
          source: 'none',
        };
      }

      // Get current member ID from the page variable (not Player 1 - that might be someone else's booking!)
      const currentMemberVar = document.querySelector('var#current-member-id');
      const currentMemberId = currentMemberVar
        ? currentMemberVar.getAttribute('data-member-id')
        : null;
      let currentUserName = null;

      // Find the logged-in user's name by searching all player options for their ID
      if (currentMemberId) {
        // Search in Player 3 select (which has all players)
        const allOptions = select.querySelectorAll('option');
        for (const opt of allOptions) {
          if (opt.value === currentMemberId) {
            currentUserName = opt.textContent.trim();
            break;
          }
        }
      }

      const categories = [];
      const allPlayers = [];
      let source = 'native-select';

      // APPROACH 1: Try to get from Select2's internal data (jQuery-based)
      try {
        if (window.jQuery && window.jQuery.fn.select2) {
          const $select = window.jQuery(select);
          const select2Instance = $select.data('select2');

          if (select2Instance && select2Instance.$results) {
            source = 'select2-internal-data';

            // Get all options from Select2 internal structure
            const $allOptions = $select.find('option');
            const players = Array.from($allOptions)
              .filter(
                (opt) =>
                  opt.value && opt.value.trim() !== '' && opt.value !== '-2',
              )
              .map((opt) => ({
                id: opt.value,
                name: opt.textContent.trim(),
                type: 'member',
              }));

            if (players.length > 0) {
              categories.push({
                name: 'Club Members',
                players: players,
              });
              allPlayers.push(...players);
            }
          }
        }
      } catch (e) {
        console.error('Select2 internal access failed:', e.message);
      }

      // APPROACH 2: If Select2 failed, try rendered dropdown elements
      if (allPlayers.length === 0) {
        const select2Results = document.querySelectorAll(
          '.select2-results__option',
        );
        if (select2Results.length > 0) {
          source = 'select2-dropdown';
          const players = Array.from(select2Results)
            .map((el) => ({
              id: el.getAttribute('data-select2-id') || el.textContent.trim(),
              name: el.textContent.trim(),
              type: 'member',
            }))
            .filter(
              (p) =>
                p.name &&
                p.name !== '' &&
                p.name !== 'Start typing to find player...',
            );

          if (players.length > 0) {
            categories.push({
              name: 'Club Members',
              players: players,
            });
            allPlayers.push(...players);
          }
        }
      }

      // APPROACH 3: If both failed, try the hidden select's option tags
      if (allPlayers.length === 0) {
        source = 'native-select-options';

        // Get from optgroups first
        const optgroups = Array.from(select.querySelectorAll('optgroup'));
        optgroups.forEach((group) => {
          const categoryName = group.getAttribute('label') || 'Players';
          const options = Array.from(group.querySelectorAll('option'));
          const players = options
            .filter(
              (opt) =>
                opt.value && opt.value.trim() !== '' && opt.value !== '-2',
            )
            .map((opt) => ({
              id: opt.value,
              name: opt.textContent.trim(),
              type: 'member',
            }));

          if (players.length > 0) {
            categories.push({
              name: categoryName,
              players: players,
            });
            allPlayers.push(...players);
          }
        });

        // If no optgroups, get direct options
        if (allPlayers.length === 0) {
          const allOptions = Array.from(select.querySelectorAll('option'));
          const directPlayers = allOptions
            .filter((opt) => {
              const val = (opt.value || '').trim();
              return val && val !== '' && val !== '-2';
            })
            .map((opt) => ({
              id: opt.value,
              name: opt.textContent.trim(),
              type: 'member',
            }));

          if (directPlayers.length > 0) {
            categories.push({
              name: 'Club Members',
              players: directPlayers,
            });
            allPlayers.push(...directPlayers);
          }
        }
      }

      return {
        categories,
        currentMemberId,
        currentUserName,
        source,
        playerCount: allPlayers.length,
      };
    });

    await browser.close();

    const totalPlayers = categorizedPlayers.categories.reduce(
      (sum, cat) => sum + cat.players.length,
      0,
    );
    console.log(
      `  ✅ Found ${totalPlayers} players in ${categorizedPlayers.categories.length} categories (source: ${categorizedPlayers.source})`,
    );
    if (categorizedPlayers.currentUserName) {
      console.log(
        `  👤 Logged-in user: ${categorizedPlayers.currentUserName} (ID: ${categorizedPlayers.currentMemberId})`,
      );
    }
    if (totalPlayers === 0) {
      console.log(
        '  ⚠️ WARNING: No players extracted; booking form may not have been fully loaded',
      );
    }

    res.json({
      success: true,
      categories: categorizedPlayers.categories,
      currentMemberId: categorizedPlayers.currentMemberId,
      currentUserName: categorizedPlayers.currentUserName,
      count: totalPlayers,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('  ❌ Error fetching player directory:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch player directory',
    });
  }
});

// SNIPER UNIFIED ENDPOINT - Check availability AND book
// Request body: { username, password, targetDate, preferredTimes, players, checkOnly }
app.post('/api/snipe', async (req, res) => {
  try {
    const {
      username,
      password,
      targetDate,
      preferredTimes,
      players,
      checkOnly,
    } = req.body;

    // Validate required fields
    if (!username || !password) {
      return res.status(400).json({ error: 'BRS credentials required' });
    }

    if (!targetDate) {
      return res.status(400).json({ error: 'Target date required' });
    }

    console.log('\n🎯 SNIPER API CALL');
    console.log(`   Mode: ${checkOnly ? 'CHECK AVAILABILITY' : 'SNIPE & BOOK'}`);
    console.log(`   Target Date: ${targetDate}`);
    console.log(`   Preferred Times: ${(preferredTimes || []).join(', ')}`);
    console.log(`   Players: ${(players || []).join(', ')}`);

    // Phase 1: Check availability
    const { times, slots } = await fetchAvailableTeeTimesFromBRS(
      new Date(targetDate),
      username,
      password,
    );

    console.log(`   ✅ Found ${slots} available slots on ${targetDate}`);

    // If checkOnly mode, just return availability
    if (checkOnly) {
      return res.json({
        success: true,
        available: slots > 0,
        slots,
        times: times || [],
        date: targetDate,
      });
    }

    // Phase 2: If slots available and NOT checkOnly, execute booking
    if (slots === 0) {
      return res.json({
        success: false,
        available: false,
        slots: 0,
        times: [],
        error: 'No available slots on this date',
        date: targetDate,
      });
    }

    // Execute booking
    const result = await runBooking({
      jobId: 'snipe-' + Date.now(),
      ownerUid: 'app-user',
      loginUrl: 'https://members.brsgolf.com/galgorm/login',
      username,
      password,
      preferredTimes: preferredTimes || [],
      targetFireTime: Date.now(),
      pushToken: null,
      targetPlayDate: targetDate,
      players: players || [],
      slotsData: times || [],  // Pass the full slots array with openSlots info
    });

    res.json({
      success: result.success,
      booked: result.success,
      result: result.result || null,
      error: result.error || null,
      mode: 'sniper',
      booking: {
        targetDate,
        selectedTime: result.bookedTime,
        preferredTimes,
        playersRequested: result.playersRequested,
        openSlots: result.bookedTime
          ? times.find(s => s.time === result.bookedTime)?.openSlots
          : null,
      },
      timing: {
        latencyMs: result.latencyMs,
        fallbackLevel: result.fallbackLevel,
      },
      notes: result.notes,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('🎯 Sniper error:', error);
    res.status(500).json({
      success: false,
      available: false,
      error: error.message || 'Sniper failed',
    });
  }
});

// Immediate booking endpoint for Normal mode
// Request body: { username, password, targetDate, preferredTimes: [time1, time2], players: [name1, name2, ...], pushToken }
app.post('/api/book-now', async (req, res) => {
  try {
    const {
      username,
      password,
      targetDate,
      preferredTimes,
      players,
      pushToken,
    } = req.body;

    // Validate required fields
    if (!username || !password) {
      return res.status(400).json({ error: 'BRS credentials are required' });
    }

    if (!targetDate) {
      return res.status(400).json({ error: 'Target date is required' });
    }

    if (!preferredTimes || preferredTimes.length === 0) {
      return res.status(400).json({ error: 'Preferred times are required' });
    }

    console.log('\n📲 Immediate Normal Mode Booking Triggered');
    console.log(`   Target Date: ${targetDate}`);
    console.log(`   Preferred Times: ${preferredTimes.join(', ')}`);
    console.log(`   Players: ${players.join(', ')}`);

    // First, fetch available slots to pass to booking function
    const { times, slots: slotsData } = await fetchAvailableTeeTimesFromBRS(
      new Date(targetDate),
      username,
      password,
    ).catch(() => ({ times: [], slots: [] }));

    // Execute booking immediately
    const result = await runBooking({
      jobId: 'immediate-' + Date.now(), // Temporary ID for immediate bookings
      ownerUid: 'web-user',
      loginUrl: 'https://members.brsgolf.com/galgorm/login',
      username,
      password,
      preferredTimes,
      targetFireTime: Date.now(), // Fire immediately
      pushToken,
      targetPlayDate: targetDate,
      players: players || [],
      slotsData: slotsData || [],  // Pass slots data for accurate player fill logic
    });

    res.json({
      success: result.success,
      booked: result.success,
      result: result.result,
      error: result.error || null,
      mode: 'normal',
      booking: {
        targetDate,
        selectedTime: result.bookedTime,
        preferredTimes,
        playersRequested: result.playersRequested,
        openSlots: result.bookedTime
          ? slotsData?.find(s => s.time === result.bookedTime)?.openSlots
          : null,
      },
      timing: {
        latencyMs: result.latencyMs,
        fallbackLevel: result.fallbackLevel,
      },
      notes: result.notes,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('📲 Immediate booking error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to execute immediate booking',
      timestamp: new Date().toISOString(),
    });
  }
});

// Warm session ensure/reset endpoints
app.post('/api/warm-ensure', async (req, res) => {
  try {
    const { username, password, targetDate } = req.body;
    await warmSession.getWarmPage(targetDate, username, password);
    res.json(warmSession.getWarmStatus());
  } catch (error) {
    res.status(500).json({ error: error.message || 'warm ensure failed' });
  }
});

app.post('/api/warm-reset', async (_req, res) => {
  try {
    await warmSession.closeWarmSession();
    res.json(warmSession.getWarmStatus());
  } catch (error) {
    res.status(500).json({ error: error.message || 'warm reset failed' });
  }
});

// Release-night helper endpoint using warm session + observer fast path
app.post('/api/release-snipe', async (req, res) => {
    res.status(202).json({
      accepted: true,
      runId,
      fireTimeUtc: new Date(fireTime).toISOString(),
      statusUrl: `/api/release-snipe/${runId}`,
    });

    // Async job, never block response
    setImmediate(async () => {
      // preserve acceptedAt
      const accepted = runStatus.get(runId);
      runStatus.set(runId, {
        ...accepted,
        state: 'running',
        runningAt: Date.now(),
      });
      try {
        const warmPage = await warmSession.getWarmPage(targetDate, username, password);
        const result = await runBooking({
          jobId: 'release-snipe-' + Date.now(),
          ownerUid: 'release-night',
          loginUrl: CONFIG.CLUB_LOGIN_URL,
          username,
          password,
          preferredTimes: times,
          targetFireTime: fireTime,
          pushToken,
          targetPlayDate: targetDate,
          players,
          slotsData: [],
          warmPage,
          useReleaseObserver: true,
          windowMinutes: winMins,
          auditRunId: runId,
          dryRun,
        });
        runStatus.set(runId, {
          ...accepted,
          state: 'finished',
          finishedAt: Date.now(),
          result: result.result,
          bookedTime: result.bookedTime,
          notes: result.notes,
          latencyMs: result.latencyMs,
          fallbackLevel: result.fallbackLevel,
          observer: {
            detected: result.observerDetected || false,
            matched: result.observerMatched || false,
            clickDeltaMs: result.observerClickDeltaMs || null,
            detectDeltaMs: result.observerDetectDeltaMs || null,
          },
        });
      } catch (error) {
        runStatus.set(runId, {
          ...accepted,
          state: 'error',
          finishedAt: Date.now(),
          error: error.message || 'release-snipe failed',
        });
      }
    });
});

app.get('/api/release-snipe/:runId', (req, res) => {
  const { runId } = req.params;
  if (!runStatus.has(runId)) {
    return res.status(404).json({ error: 'unknown runId' });
  }
  res.json(runStatus.get(runId));
});

// Warm session status (debug)
app.get('/api/warm-status', (req, res) => {
  res.json(warmSession.getWarmStatus());
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'fairway-sniper-agent' });
});

// Start HTTP server
const PORT = process.env.PORT || 3000;
server = app.listen(PORT, () => {
  console.log(`✅ fairway-sniper-agent listening on http://localhost:${PORT}`);
  console.log(`   - Health: http://localhost:${PORT}/api/health`);
  console.log(`   - Sniper (unified): POST http://localhost:${PORT}/api/snipe`);
  console.log(`   - Fetch Tee Times: POST http://localhost:${PORT}/api/fetch-tee-times`);
  console.log(`   - Release Snipe: POST http://localhost:${PORT}/api/release-snipe`);
  console.log(`   - Release Snipe Status: GET http://localhost:${PORT}/api/release-snipe/:runId`);
});
server.on('error', (err) => {
  console.error('[server error]', err?.stack || err);
});
server.on('listening', () => {
  console.log('[server listening]', server.address());
});

// Run booking automation only when explicitly requested
if (
  import.meta.url === `file://${process.argv[1]}` &&
  process.env.AGENT_RUN_MAIN === 'true'
) {
  main();
}
