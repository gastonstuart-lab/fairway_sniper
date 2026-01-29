

console.log('=== [AGENT] index.js starting (isolation test) ===');
import 'dotenv/config';
import { chromium } from '@playwright/test';
import express from 'express';
import cors from 'cors';
import admin from 'firebase-admin';
console.log('=== [AGENT] index.js (no requires) ===');

// ...existing code...
const app = express();
app.use(cors());
app.use(express.json());

// ========================================
// FIREBASE ADMIN INIT (optional)
// ========================================

let db = null;

function initFirebaseAdmin() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    console.log(
      '⚠️ Firebase Admin not configured. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY to enable DB logging.',
    );
    return;
  }

  try {
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey: privateKey.replace(/\\n/g, '\n'),
        }),
      });
    }
    db = admin.firestore();
    console.log('✅ Firebase Admin initialized');
  } catch (error) {
    console.error('❌ Firebase Admin init failed:', error);
  }
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
  CAPTCHA_API_KEY: process.env.CAPTCHA_API_KEY || '',
  DRY_RUN: process.argv.includes('--dry-run'),
};

initFirebaseAdmin();



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

      // Strategy 0: Select by ID (preferred for sniper jobs)
      if (/^\d+$/.test(playerName)) {
        const selectId = `#member_booking_form_player_${playerNum}`;
        const selectElem = page.locator(selectId).first();
        if (await selectElem.count()) {
          try {
            await selectElem.selectOption({ value: playerName });
            console.log(`    ✅ Player ${playerNum}: ${playerName} (select by id)`);
            result.filled.push(playerName);
            filled = true;
          } catch (e) {
            console.log(`    ℹ️ Strategy 0 (select by id) failed: ${e.message.substring(0, 50)}`);
          }
        }
      }

      // Strategy A: Try getByRole('combobox')
      if (!filled) {
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

async function runBooking(config) {
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
    partySize,
    slotsData = [],  // Array of {time, openSlots, status}
  } = config;

  if (!username || !password) {
    throw new Error('Missing BRS credentials for booking run');
  }

  let browser;
  let runId;
  const startTime = Date.now();
  const teeDate = targetPlayDate ? new Date(targetPlayDate) : new Date();
  const notes = [];

  try {
    console.log('='.repeat(60));
    console.log('FAIRWAY SNIPER - BOOKING AGENT STARTED');
    console.log('='.repeat(60));
    console.log(`Job ID: ${jobId}`);
    console.log(`Target fire time: ${new Date(targetFireTime).toISOString()}`);
    console.log(`Preferred times: ${preferredTimes.join(', ')}`);

    // Create run record
    runId = await fsAddRun(
      jobId,
      ownerUid,
      new Date(),
      'Booking attempt started',
    );

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

    const page = await context.newPage();

    // Navigate and login
    console.log(`\n[2/5] Navigating to ${loginUrl}...`);
    await loginToBRS(page, loginUrl, username, password);

    console.log(
      `\n[3/5] Loading tee sheet for ${teeDate.toISOString().slice(0, 10)}...`,
    );
    await navigateToTeeSheet(page, teeDate);

    // Coarse wait until near target time
    await coarseWaitUntil(targetFireTime);

    // Spin-wait for precise timing
    console.log('\n[4/5] Executing precise timing...');
    await spinUntil(targetFireTime);

    // BOOKING EXECUTION
    console.log('\n[5/5] 🎯 ATTEMPTING BOOKING NOW!');
    const bookingStartTime = Date.now();

    let bookedTime = null;
    let fallbackLevel = 0;

    // Only fill additional players (Player 1 is the logged-in user)
    const desiredAdditionalCount =
      typeof partySize === 'number' ? Math.max(0, partySize - 1) : players.length;
    const additionalPlayers = players.slice(0, desiredAdditionalCount);

    // Try each preferred time in order
    for (const [index, time] of preferredTimes.entries()) {
      try {
        console.log(`Trying time slot: ${time}`);
        
        // Find openSlots for this time from slotsData
        const slotInfo = slotsData.find(s => s.time === time);
        const openSlots = slotInfo ? slotInfo.openSlots : 3; // default to 3 if not found
        
        const bookingResult = await tryBookTime(
          page,
          time,
          additionalPlayers,
          openSlots,
        );
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

    // Send notification
    await sendPushFCM(notificationTitle, notificationBody, pushToken);

    console.log('\n' + '='.repeat(60));
    console.log(`RESULT: ${result.toUpperCase()}`);
    if (bookedTime) console.log(`BOOKED TIME: ${bookedTime}`);
    console.log(`LATENCY: ${latencyMs}ms`);
    console.log(`NOTES: ${notes.join(' | ')}`);
    console.log('='.repeat(60));

    await browser.close();

    return {
      success: result === 'success' || result === 'fallback',
      result,
      bookedTime,
      fallbackLevel,
      latencyMs,
      notes: notes.join(' | '),
      playersRequested: additionalPlayers,
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

    if (browser) await browser.close();

    return { success: false, error: error.message };
  }
}

// ========================================


// ========================================
// TEE TIME FETCHER (HTTP ENDPOINT)
// ========================================



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

    await loginToBRS(page, CONFIG.CLUB_LOGIN_URL, username, password);
    await navigateToTeeSheet(page, date);

    const slots = await scrapeTeeTimesFromPage(page);

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

async function scrapeTeeTimesFromPage(page) {
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

  const slots = await page.$$eval('a[href*="/bookings/book/"]', (anchors) => {
    const seen = new Set();
    const out = [];

    const guessBookedCount = (row) => {
      if (!row) return 0;
      const cells = Array.from(row.querySelectorAll('td'));
      const playerCells = cells.filter((td) => {
        const text = (td.innerText || '').trim();
        if (!text || text.length < 3) return false;
        if (/^\d{1,2}:\d{2}/.test(text)) return false;
        if (/book now|add|waiting|view/i.test(text)) return false;
        return true;
      });

      const allText = playerCells.map((td) => td.innerText || '').join('\n');
      const tokens = allText
        .split(/\n+/)
        .map((t) => t.trim())
        .filter(Boolean);

      const seenNames = new Set();
      const nameTokens = tokens.filter((t) => {
        const lower = t.toLowerCase();
        if (!/[a-z]/i.test(t)) return false;
        if (/\d{1,2}:\d{2}/.test(lower)) return false;
        if (
          /book|booking|available|waiting|waitlist|wait list|open|holes|format|course|tee|sheet|buggy|buggies|price|rate|member|login|book now|member booked/i.test(
            lower,
          )
        )
          return false;
        if (/£|€|\$/.test(t)) return false;
        if (/^\d+$/.test(t)) return false;

        const cleaned = t.replace(/[^a-zA-Z'\-\s]/g, '').trim();
        if (cleaned.length < 2) return false;
        if (!/[a-zA-Z]{2}/.test(cleaned)) return false;

        const key = cleaned.toLowerCase();
        if (seenNames.has(key)) return false;
        seenNames.add(key);
        return true;
      });

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

      let row = a.closest('tr');
      if (!row) row = a.closest('td')?.parentElement;
      if (!row) row = a.parentElement;

      const totalSlots = 4;
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

  return slots;
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
    const { startDate, days, username, password, reuseBrowser } = req.body;
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
    if (reuseBrowser === true) {
      const browser = await chromium.launch({
        headless: true,
        args: ['--disable-blink-features=AutomationControlled'],
      });
      try {
        const context = await browser.newContext({
          userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          viewport: { width: 1280, height: 720 },
        });
        const page = await context.newPage();
        await loginToBRS(page, CONFIG.CLUB_LOGIN_URL, username, password);

        for (let i = 0; i < Number(days); i++) {
          const targetDate = new Date(start);
          targetDate.setDate(start.getDate() + i);
          const dayStr = targetDate.toISOString().slice(0, 10);
          await navigateToTeeSheet(page, targetDate);
          const slots = await scrapeTeeTimesFromPage(page);
          const sorted = slots.sort((a, b) => a.time.localeCompare(b.time));
          results.push({
            date: dayStr,
            times: sorted.map((s) => s.time),
            slots: sorted,
          });
        }
      } finally {
        await browser.close();
      }
    } else {
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

async function fetchPlayerDirectoryFromBRS({ userId, username, password }) {
  console.log(`\n🔍 Fetching player directory for user ${userId}...`);

  const browser = await chromium.launch({ headless: true });

  // DON'T use stored session for player directory - need fresh login to get correct Player 1 name
  let contextOptions = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    viewport: { width: 1920, height: 1080 },
  };

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  // Reuse proven login + tee sheet navigation (same as /api/snipe -> runBooking)
  await loginToBRS(page, CONFIG.CLUB_LOGIN_URL, username, password);
  const today = new Date();
  await navigateToTeeSheet(page, today);

  // Evidence capture before selecting a booking link (tee sheet state)
  const fs = await import('fs');
  const path = await import('path');
  const outputDir = path.join(process.cwd(), 'output');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  await fs.promises.mkdir(outputDir, { recursive: true }).catch(() => {});
  const prebookScreenshot = path.join(outputDir, `player_dir_prebook_${timestamp}.png`);
  const prebookHtml = path.join(outputDir, `player_dir_prebook_${timestamp}.html`);
  await page.screenshot({ path: prebookScreenshot, fullPage: true }).catch(() => {});
  const prebookDump = await page.content();
  await fs.promises.writeFile(prebookHtml, prebookDump.slice(0, 120000), 'utf8').catch(() => {});
  console.log(`  🌐 Prebook URL: ${page.url()} frames=${page.frames().length}`);
  console.log(`  💾 Prebook snapshot: ${prebookScreenshot}, ${prebookHtml}`);

  // Ensure tee sheet rows/book links are loaded (same page state /api/snipe relies on)
  const detailBtn = page.locator('button#detail, button:has-text("Detail")').first();
  if (await detailBtn.isVisible().catch(() => false)) {
    await detailBtn.click().catch(() => {});
  }
  const start = Date.now();
  const pollTimeout = 20000;
  let bookingLinkCount = 0;
  while (Date.now() - start < pollTimeout) {
    bookingLinkCount = await page.locator('a[href*="/bookings/book/"]').count();
    if (bookingLinkCount > 0) break;
    await page.waitForTimeout(300);
  }

  // Pick first booking link that leads to a form with Player 2 enabled
  let bookingLinks = [];
  if (bookingLinkCount > 0) {
    bookingLinks = await page.$$eval('a[href*="/bookings/book/"]', (anchors) => {
      const hrefs = anchors.map((a) => a.getAttribute('href')).filter(Boolean);
      return Array.from(new Set(hrefs));
    });
  } else {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      const count = await frame.locator('a[href*="/bookings/book/"]').count().catch(() => 0);
      if (count > 0) {
        bookingLinks = await frame.$$eval('a[href*="/bookings/book/"]', (anchors) => {
          const hrefs = anchors.map((a) => a.getAttribute('href')).filter(Boolean);
          return Array.from(new Set(hrefs));
        });
        break;
      }
    }
  }
  if (!bookingLinks.length) {
    throw new Error('No booking links found on tee sheet');
  }

  let chosenHref = null;
  for (const href of bookingLinks) {
    const bookingUrl = new URL(href, 'https://members.brsgolf.com/galgorm');
    await page.goto(bookingUrl.href, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(1500);
    await page.locator('text=Player 1').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});

    const player2 = await page.$('select#member_booking_form_player_2');
    const disabled = player2 ? await player2.getAttribute('disabled') : 'true';
    const p2Select2 = page.locator('select#member_booking_form_player_2 + span.select2 .select2-selection').first();
    const p2AriaDisabled = (await p2Select2.getAttribute('aria-disabled').catch(() => 'true')) || 'true';
    if (!disabled && p2AriaDisabled !== 'true') {
      chosenHref = href;
      break;
    }

    // Not enough open slots; return to tee sheet and try next
    await navigateToTeeSheet(page, today);
  }

  if (!chosenHref) {
    throw new Error('No bookable tee time with >=2 open slots found');
  }

  // Minimal, proven Select2 scraping: open dropdown, scrape all visible names, return flat list
  // --- HUMAN-ACCURATE SELECT2 SCRAPING LOGIC ---
  // (A) Ensure booking details page is open
  let onBookingPage = page.url().includes('/bookings/book/') || (await page.locator('text=Player 1').isVisible().catch(() => false));
  if (!onBookingPage) {
    // Click first available tee time row
    const bookBtn = page.locator('a[href*="/bookings/book/"]').first();
    if (!(await bookBtn.isVisible().catch(() => false))) {
      throw new Error('No Book button found on tee sheet');
    }
    await bookBtn.click();
    await page.waitForTimeout(2000);
    onBookingPage = true;
  }
  // (B) Open Select2 for first enabled player slot
  let foundDropdownNum = null;
  for (const num of [2, 3, 4]) {
    const selectSel = `select#member_booking_form_player_${num}`;
    const selectElem = await page.$(selectSel);
    if (!selectElem) continue;
    const isDisabled = await selectElem.getAttribute('disabled');
    if (isDisabled) continue;

    const selectorsToTry = [
      `${selectSel} + span.select2 .select2-selection`,
      `.select2-container[aria-owns*="player_${num}"] .select2-selection`,
      `.select2-selection[aria-labelledby="select2-member_booking_form_player_${num}-container"]`,
    ];
    let clicked = false;
    for (const sel of selectorsToTry) {
      const box = page.locator(sel).first();
      const ariaDisabled = await box.getAttribute('aria-disabled').catch(() => 'true');
      if (await box.isVisible().catch(() => false) && ariaDisabled !== 'true') {
        foundDropdownNum = num;
        await box.click();
        clicked = true;
        break;
      }
    }
    if (clicked) break;
  }
  if (!foundDropdownNum) throw new Error('No enabled Select2 player field found');
  // (C) Wait for open Select2 results container (try selectors in order, page then frames)
  const selectors = [
    'body .select2-container--open .select2-results',
    'body .select2-dropdown .select2-results',
    'body .select2-results',
  ];
  let resultsHandle = null, matchedSelector = null, matchedFrame = null;
  for (const sel of selectors) {
    const h = await page.$(sel);
    if (h) { resultsHandle = h; matchedSelector = sel; matchedFrame = null; break; }
  }
  if (!resultsHandle) {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      for (const sel of selectors) {
        const h = await frame.$(sel);
        if (h) { resultsHandle = h; matchedSelector = sel; matchedFrame = frame; break; }
      }
      if (resultsHandle) break;
    }
  }
  // (E) Diagnostics: screenshot and HTML dump
  const screenshotFile = path.join(outputDir, `player_dir_open_${timestamp}.png`);
  await page.screenshot({ path: screenshotFile, fullPage: true }).catch(() => {});
  let htmlDump = '';
  if (resultsHandle) {
    if (matchedFrame) {
      htmlDump = await matchedFrame.evaluate(el => el.outerHTML, resultsHandle);
    } else {
      htmlDump = await page.evaluate(el => el.outerHTML, resultsHandle);
    }
    const htmlFile = path.join(outputDir, `player_dir_open_${timestamp}.html`);
    await fs.promises.writeFile(htmlFile, htmlDump.slice(0, 120000), 'utf8').catch(() => {});
  }
  // (C, cont) If still not found, error
  if (!resultsHandle) {
    const failHtml = await page.content();
    await fs.promises.writeFile(path.join(outputDir, `player_dir_fail_${timestamp}.html`), failHtml.slice(0, 120000), 'utf8').catch(() => {});
    throw new Error('Could not find open Select2 results container in any frame');
  }
  // (D) Scrape all categories + names from open results
  const categorizedPlayers = await (matchedFrame || page).evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return { categories: [], playerCount: 0 };
    const categories = [];
    let currentCategory = null, catObj = null;
    const idSet = new Set();
    let groupCount = 0, optionCount = 0;
    const items = Array.from(
      root.querySelectorAll('.select2-results__group, .select2-results__option')
    );
    for (const el of items) {
      if (el.classList.contains('select2-results__group')) {
        if (catObj && catObj.players.length) categories.push(catObj);
        currentCategory = el.innerText.trim();
        catObj = { name: currentCategory, players: [] };
        groupCount++;
        } else if (
          el.classList.contains('select2-results__option') &&
          !el.classList.contains('select2-results__option--disabled') &&
          el.getAttribute('aria-disabled') !== 'true'
        ) {
          if (el.getAttribute('role') === 'group') continue;
          let name = el.innerText
            .trim()
            .replace(/^Member\s*/i, '')
            .replace(/\s+Holes.*/i, '')
            .replace(/\s+/g, ' ');
          if (!name || /Start typing|Searching/i.test(name)) continue;
          const rawId =
            el.getAttribute('data-select2-id') ||
            el.id ||
            el.getAttribute('value') ||
            btoa(unescape(encodeURIComponent(name))).slice(0, 16);
          let id = rawId;
          const match = String(rawId).match(/-(\d+)$/);
          if (match) id = match[1];
          if (idSet.has(id)) continue;
          idSet.add(id);
        const type = /guest/i.test(name) ? 'guest' : 'member';
        if (!catObj) catObj = { name: 'Players', players: [] };
        catObj.players.push({ id, name, type });
        optionCount++;
      }
    }
    if (catObj && catObj.players.length) categories.push(catObj);
    const playerCount = categories.reduce((sum, c) => sum + c.players.length, 0);
    return { categories, playerCount, groupCount, optionCount };
  }, matchedSelector);
  // (E) Log selector/frame info and counts
  console.log(`  🟢 Select2 scrape: selector=${matchedSelector} frame=${matchedFrame ? page.frames().indexOf(matchedFrame) : 'main'} groups=${categorizedPlayers.groupCount} options=${categorizedPlayers.optionCount} uniquePlayers=${categorizedPlayers.playerCount}`);
  // (F) Return unchanged schema
  await browser.close();
  return {
    categories: categorizedPlayers.categories,
    currentMemberId: null,
    currentUserName: null,
    count: categorizedPlayers.playerCount,
    fetchedAt: new Date().toISOString(),
  };
}

// Fetch player directory endpoint (scrapes player names from booking form)
app.post('/api/brs/fetch-player-directory', async (req, res) => {
  try {
    const { userId, username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'BRS credentials are required' });
    }

    const payload = await fetchPlayerDirectoryFromBRS({ userId, username, password });
    return res.json({
      success: true,
      ...payload,
    });
  } catch (error) {
    console.error('  ❌ Error fetching player directory:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch player directory',
    });
  }
});

// Wizard-friendly player directory endpoint
app.post('/api/brs/player-directory', async (req, res) => {
  try {
    const { userId, username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'BRS credentials are required' });
    }
    const payload = await fetchPlayerDirectoryFromBRS({ userId, username, password });
    return res.json({
      success: true,
      ...payload,
    });
  } catch (error) {
    console.error('  ❌ Error fetching player directory (wizard):', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch player directory',
    });
  }
});
/*
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
    // Try Player 2, 3, then 4 in order, use the first enabled one
    const playerDropdownIds = [2, 3, 4];
    let foundDropdown = null;
    let foundDropdownNum = null;
    for (const num of playerDropdownIds) {
      const selector = `select#member_booking_form_player_${num}`;
      const selectElem = await page.$(selector);
      if (selectElem) {
        const isDisabled = await selectElem.getAttribute('disabled');
        if (!isDisabled) {
          foundDropdown = selector;
          foundDropdownNum = num;
          break;
        }
      }
    }
    if (!foundDropdown) {
      throw new Error('No enabled player dropdown (2, 3, or 4) found');
    }
    console.log(`  🎯 Using Player ${foundDropdownNum} dropdown for scraping`);

    // Wait for the select to exist
    // --- OPEN-SELECT2 SCRAPING LOGIC ---
    // 1. Find the Select2 visible selection area for the enabled player field
    const select2Selector = `#member_booking_form_player_${foundDropdownNum}`;
    const select2Container = await page.locator(
      `.select2-container[aria-owns*="player_${foundDropdownNum}"] .select2-selection`
    ).first();
    if (!(await select2Container.isVisible().catch(() => false))) {
      throw new Error(`Select2 selection area not found for Player ${foundDropdownNum}`);
    }
    await select2Container.click();
    // 2. Wait for Select2 results in body (main page or any frame)
    let resultsHandle = null;
    let matchedSelector = null;
    let matchedFrame = null;
    const selectors = [
      'body .select2-container--open .select2-results',
      'body .select2-dropdown .select2-results',
    ];
    // Try main page first
    for (const sel of selectors) {
      const handle = await page.$(sel);
      if (handle) {
        resultsHandle = handle;
        matchedSelector = sel;
        matchedFrame = null;
        break;
      }
    }
    // If not found, try all frames
    if (!resultsHandle) {
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        for (const sel of selectors) {
          const handle = await frame.$(sel);
          if (handle) {
            resultsHandle = handle;
            matchedSelector = sel;
            matchedFrame = frame;
            break;
          }
        }
        if (resultsHandle) break;
      }
    }
    if (!resultsHandle) {
      throw new Error('Could not find open Select2 results container in any frame');
    }
    // 3. Diagnostics: screenshot and HTML dump
    const fs = await import('fs');
    const path = await import('path');
    const outputDir = path.join(process.cwd(), 'output');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    await fs.promises.mkdir(outputDir, { recursive: true }).catch(() => {});
    const screenshotFile = path.join(outputDir, `player_dir_open_${timestamp}.png`);
    await page.screenshot({ path: screenshotFile, fullPage: true }).catch(() => {});
    let htmlDump = '';
    if (matchedFrame) {
      htmlDump = await matchedFrame.evaluate((el) => el.outerHTML, resultsHandle);
    } else {
      htmlDump = await page.evaluate((el) => el.outerHTML, resultsHandle);
    }
    const htmlFile = path.join(outputDir, `player_dir_open_${timestamp}.html`);
    await fs.promises.writeFile(htmlFile, htmlDump.slice(0, 120000), 'utf8').catch(() => {});
    console.log(`  💾 Saved screenshot: ${screenshotFile}`);
    console.log(`  💾 Saved dropdown HTML: ${htmlFile}`);
    // 4. Scrape categories and options from the open Select2 results
    const categorizedPlayers = await (matchedFrame || page).evaluate((sel) => {
      const root = document.querySelector(sel);
      if (!root) return { categories: [], source: 'none', playerCount: 0 };
      const headers = Array.from(root.querySelectorAll('.select2-results__group'));
      const options = Array.from(root.querySelectorAll('.select2-results__option'));
      let currentCategory = null;
      const categories = [];
      const idSet = new Set();
      let catObj = null;
      for (const el of root.children) {
        if (el.classList.contains('select2-results__group')) {
          if (catObj) categories.push(catObj);
          currentCategory = el.innerText.trim();
          catObj = { name: currentCategory, players: [] };
        } else if (el.classList.contains('select2-results__option') && !el.classList.contains('select2-results__option--disabled')) {
          let name = el.innerText.trim().replace(/^Member\s* /i, '').replace(/\s+Holes.* /i, '').replace(/\s+/g, ' ');
          if (!name || /Start typing/i.test(name)) continue;
          let id = el.getAttribute('data-select2-id') || el.id || btoa(unescape(encodeURIComponent(name))).slice(0, 16);
          if (idSet.has(id)) continue;
          idSet.add(id);
          const type = /guest/i.test(name) ? 'guest' : 'member';
          if (!catObj) {
            catObj = { name: 'Players', players: [] };
          }
          catObj.players.push({ id, name, type });
        }
      }
      if (catObj && catObj.players.length) categories.push(catObj);
      const playerCount = categories.reduce((sum, c) => sum + c.players.length, 0);
      return { categories, source: 'select2-open-results', playerCount };
    }, matchedSelector);
    // 5. Log selector/frame info and counts
    console.log(`  🟢 Select2 scrape: selector=${matchedSelector} frame=${matchedFrame ? page.frames().indexOf(matchedFrame) : 'main'} categories=${categorizedPlayers.categories.length} totalPlayers=${categorizedPlayers.playerCount}`);

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
*/

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
      partySize,
      checkOnly,
      previewBooking,
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

    const slotsCount = Array.isArray(slots)
      ? slots.reduce((sum, s) => sum + (s.openSlots || 0), 0)
      : Number(slots) || 0;
    console.log(`   ✅ Found ${slotsCount} available slots on ${targetDate}`);

    // If checkOnly mode, just return availability
    if (checkOnly) {
      return res.json({
        success: true,
        available: slotsCount > 0,
        slots: slotsCount,
        times: times || [],
        date: targetDate,
      });
    }

    // Preview booking mode: open booking details + select2, then exit safely
    if (previewBooking === true) {
      const browser = await chromium.launch({ headless: true });
      try {
        const context = await browser.newContext({
          userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          viewport: { width: 1920, height: 1080 },
        });
        const page = await context.newPage();

        await loginToBRS(page, CONFIG.CLUB_LOGIN_URL, username, password);
        const today = new Date(targetDate);
        await navigateToTeeSheet(page, today);

        const detailBtn = page
          .locator('button#detail, button:has-text("Detail")')
          .first();
        if (await detailBtn.isVisible().catch(() => false)) {
          await detailBtn.click().catch(() => {});
        }
        const start = Date.now();
        const pollTimeout = 20000;
        let bookingLinkCount = 0;
        while (Date.now() - start < pollTimeout) {
          bookingLinkCount = await page
            .locator('a[href*="/bookings/book/"]')
            .count();
          if (bookingLinkCount > 0) break;
          await page.waitForTimeout(300);
        }

        let bookingLinks = [];
        if (bookingLinkCount > 0) {
          bookingLinks = await page.$$eval(
            'a[href*="/bookings/book/"]',
            (anchors) => {
              const hrefs = anchors
                .map((a) => a.getAttribute('href'))
                .filter(Boolean);
              return Array.from(new Set(hrefs));
            },
          );
        } else {
          for (const frame of page.frames()) {
            if (frame === page.mainFrame()) continue;
            const count = await frame
              .locator('a[href*="/bookings/book/"]')
              .count()
              .catch(() => 0);
            if (count > 0) {
              bookingLinks = await frame.$$eval(
                'a[href*="/bookings/book/"]',
                (anchors) => {
                  const hrefs = anchors
                    .map((a) => a.getAttribute('href'))
                    .filter(Boolean);
                  return Array.from(new Set(hrefs));
                },
              );
              break;
            }
          }
        }
        if (!bookingLinks.length) {
          throw new Error('No booking links found on tee sheet');
        }

        let chosenHref = null;
        for (const href of bookingLinks) {
          const bookingUrl = new URL(
            href,
            'https://members.brsgolf.com/galgorm',
          );
          await page.goto(bookingUrl.href, {
            waitUntil: 'domcontentloaded',
            timeout: 45000,
          });
          await page.waitForTimeout(1500);
          await page
            .locator('text=Player 1')
            .first()
            .waitFor({ state: 'visible', timeout: 15000 })
            .catch(() => {});

          const player2 = await page.$('select#member_booking_form_player_2');
          const disabled = player2
            ? await player2.getAttribute('disabled')
            : 'true';
          const p2Select2 = page
            .locator(
              'select#member_booking_form_player_2 + span.select2 .select2-selection',
            )
            .first();
          const p2AriaDisabled =
            (await p2Select2
              .getAttribute('aria-disabled')
              .catch(() => 'true')) || 'true';
          if (!disabled && p2AriaDisabled !== 'true') {
            chosenHref = href;
            break;
          }

          await navigateToTeeSheet(page, today);
        }

        if (!chosenHref) {
          throw new Error('No bookable tee time with >=2 open slots found');
        }

        // Assert booking details + open Select2
        await page
          .locator('text=Player 1')
          .first()
          .waitFor({ state: 'visible', timeout: 15000 });
        const player2Select = await page.$(
          'select#member_booking_form_player_2',
        );
        if (!player2Select) {
          throw new Error('Player 2 field not found on booking details');
        }

        const select2Box = page
          .locator(
            'select#member_booking_form_player_2 + span.select2 .select2-selection',
          )
          .first();
        await select2Box.click();

        const selectors = [
          'body .select2-container--open .select2-results',
          'body .select2-dropdown .select2-results',
          'body .select2-results',
        ];
        let resultsHandle = null;
        let matchedSelector = null;
        let matchedFrame = null;
        for (const sel of selectors) {
          const h = await page.$(sel);
          if (h) {
            resultsHandle = h;
            matchedSelector = sel;
            matchedFrame = null;
            break;
          }
        }
        if (!resultsHandle) {
          for (const frame of page.frames()) {
            if (frame === page.mainFrame()) continue;
            for (const sel of selectors) {
              const h = await frame.$(sel);
              if (h) {
                resultsHandle = h;
                matchedSelector = sel;
                matchedFrame = frame;
                break;
              }
            }
            if (resultsHandle) break;
          }
        }
        if (!resultsHandle) {
          throw new Error('Could not find open Select2 results container');
        }

        const select2OptionsCount = await (matchedFrame || page).evaluate(
          (sel) => {
            const root = document.querySelector(sel);
            if (!root) return 0;
            const options = root.querySelectorAll(
              '.select2-results__option:not(.select2-results__option--disabled)',
            );
            return options.length;
          },
          matchedSelector,
        );

        if (select2OptionsCount < 20) {
          throw new Error(
            `Select2 options count too low: ${select2OptionsCount}`,
          );
        }

        const fs = await import('fs');
        const path = await import('path');
        const outputDir = path.join(process.cwd(), 'output');
        const timestamp = new Date()
          .toISOString()
          .replace(/[:.]/g, '-')
          .slice(0, -5);
        await fs.promises.mkdir(outputDir, { recursive: true }).catch(() => {});
        const screenshotFile = path.join(
          outputDir,
          `preview_booking_${timestamp}.png`,
        );
        await page.screenshot({ path: screenshotFile, fullPage: true }).catch(
          () => {},
        );

        await browser.close();
        return res.json({
          success: true,
          preview: true,
          reachedBookingDetails: true,
          select2OptionsCount,
        });
      } catch (error) {
        await browser.close();
        throw error;
      }
    }

    // Phase 2: If slots available and NOT checkOnly, execute booking
    if (slotsCount === 0) {
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
      targetFireTime: new Date(),
      pushToken: null,
      targetPlayDate: targetDate,
      players: players || [],
      partySize,
      slotsData: slots || [],  // Pass the full slots array with openSlots info
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
          ? slots.find(s => s.time === result.bookedTime)?.openSlots
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
      partySize,
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
      targetFireTime: new Date(), // Fire immediately
      pushToken,
      targetPlayDate: targetDate,
      players: players || [],
      partySize,
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

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'fairway-sniper-agent' });
});


async function main() {
  // Start HTTP server
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Fairway Sniper Agent HTTP server running on port ${PORT}`);
    console.log(`   - Health: http://localhost:${PORT}/api/health`);
    console.log(
      `   - Sniper (unified): POST http://localhost:${PORT}/api/snipe`,
    );
    console.log(
      `   - Fetch Tee Times: POST http://localhost:${PORT}/api/fetch-tee-times`,
    );
  });
}

if (globalThis.__BOOT_OK__ === true) {
  main();
}


// Query Firestore for one active job (used by agent main loop)
async function fsGetOneActiveJob() {
  if (!db) return null;
  try {
    const snapshot = await db
      .collection('jobs')
      .where('status', '==', 'active')
      .orderBy('created_at', 'asc')
      .limit(1)
      .get();
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    return { id: doc.id, ...doc.data() };
  } catch (error) {
    console.error('Error fetching active job:', error);
    return null;
  }
}

export {
  main,
  runBooking,
  computeNextFireUTC,
  fsGetOneActiveJob,
  fetchAvailableTeeTimesFromBRS,
};
