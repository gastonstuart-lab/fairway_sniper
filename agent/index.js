#!/usr/bin/env node

import { chromium } from '@playwright/test';
import admin from 'firebase-admin';
import { DateTime } from 'luxon';
import fetch from 'node-fetch';

// ========================================
// CONFIGURATION FROM ENVIRONMENT VARIABLES
// ========================================

const CONFIG = {
  CLUB_LOGIN_URL: process.env.CLUB_LOGIN_URL || 'https://members.brsgolf.com/galgorm/login',
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
// FIREBASE INITIALIZATION
// ========================================

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: CONFIG.FIREBASE_PROJECT_ID,
      clientEmail: CONFIG.FIREBASE_CLIENT_EMAIL,
      privateKey: CONFIG.FIREBASE_PRIVATE_KEY,
    }),
  });
}

const db = admin.firestore();

// ========================================
// FIRESTORE HELPER FUNCTIONS
// ========================================

async function fsGetOneActiveJob() {
  try {
    const snapshot = await db.collection('jobs')
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
  try {
    await db.collection('jobs').doc(jobId).update({
      ...patch,
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`Job ${jobId} updated`);
  } catch (error) {
    console.error('Error updating job:', error);
  }
}

async function fsAddRun(jobId, ownerUid, startedUtc, notes) {
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
  try {
    await db.collection('runs').doc(runId).update({
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
    const message = {
      notification: { title, body },
      token,
    };
    
    await admin.messaging().send(message);
    console.log(`Push notification sent: ${title}`);
  } catch (error) {
    console.error('Error sending FCM:', error);
  }
}

// ========================================
// CAPTCHA PLACEHOLDER
// ========================================

/**
 * PLACEHOLDER ONLY - For third-party CAPTCHA solver integration
 * 
 * TODO: If you need to integrate a CAPTCHA solver service:
 * 1. Use your own CAPTCHA solver API (e.g., 2Captcha, Anti-Captcha)
 * 2. Detect CAPTCHA presence on the page
 * 3. Submit the CAPTCHA challenge to your solver
 * 4. Wait for the solution
 * 5. Submit the solution to the page
 * 
 * This function should return true if CAPTCHA was detected and solved,
 * false if no CAPTCHA was present.
 */
async function maybeSolveCaptcha(page) {
  // PLACEHOLDER ONLY.
  // If you later integrate a CAPTCHA solver, implement it here.
  // DO NOT include any CAPTCHA-bypass logic without proper authorization.
  return false;
}

// ========================================
// TIME CALCULATION
// ========================================

function computeNextFireUTC(releaseDay, releaseTimeLocal, timezone) {
  const tz = timezone || CONFIG.TZ_LONDON;
  const now = DateTime.now().setZone(tz);
  
  const daysOfWeek = {
    'Monday': 1, 'Tuesday': 2, 'Wednesday': 3, 'Thursday': 4,
    'Friday': 5, 'Saturday': 6, 'Sunday': 7
  };
  
  const targetWeekday = daysOfWeek[releaseDay];
  let daysUntil = (targetWeekday - now.weekday + 7) % 7;
  
  const [hour, minute] = releaseTimeLocal.split(':').map(Number);
  let targetDateTime = now.set({ hour, minute, second: 0, millisecond: 0 });
  
  if (daysUntil === 0 && now > targetDateTime) {
    daysUntil = 7;
  }
  
  targetDateTime = targetDateTime.plus({ days: daysUntil });
  
  return targetDateTime.toUTC().toJSDate();
}

// ========================================
// PRECISE TIMING FUNCTIONS
// ========================================

async function coarseWaitUntil(targetTime) {
  const now = Date.now();
  const msUntil = targetTime - now - 5000; // Wait until 5 seconds before
  
  if (msUntil > 0) {
    console.log(`Coarse waiting ${Math.round(msUntil / 1000)}s until T-5s`);
    await new Promise(resolve => setTimeout(resolve, msUntil));
  }
}

async function spinUntil(targetTime) {
  console.log('Starting spin-wait for millisecond precision...');
  while (Date.now() < targetTime) {
    // Busy-wait for precise timing
    await new Promise(resolve => setImmediate(resolve));
  }
  console.log('Target time reached!');
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
  } = config;

  let browser;
  let runId;
  const startTime = Date.now();
  
  try {
    console.log('='.repeat(60));
    console.log('FAIRWAY SNIPER - BOOKING AGENT STARTED');
    console.log('='.repeat(60));
    console.log(`Job ID: ${jobId}`);
    console.log(`Target fire time: ${new Date(targetFireTime).toISOString()}`);
    console.log(`Preferred times: ${preferredTimes.join(', ')}`);
    
    // Create run record
    runId = await fsAddRun(jobId, ownerUid, new Date(), 'Booking attempt started');
    
    // Launch browser
    console.log('\n[1/5] Launching headless browser...');
    browser = await chromium.launch({
      headless: true,
      args: ['--disable-blink-features=AutomationControlled'],
    });
    
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
    });
    
    const page = await context.newPage();
    
    // Navigate and login
    console.log(`\n[2/5] Navigating to ${loginUrl}...`);
    await page.goto(loginUrl, { waitUntil: 'networkidle' });
    
    // Check for CAPTCHA
    const captchaDetected = await maybeSolveCaptcha(page);
    if (captchaDetected) {
      console.log('CAPTCHA detected - solver placeholder executed');
    }
    
    console.log('\n[3/5] Performing login...');
    
    // TODO: Replace with actual DOM selectors for the BRS Golf site
    // Example selectors (update these based on the actual site structure):
    // await page.fill('input[name="username"]', username);
    // await page.fill('input[name="password"]', password);
    // await page.click('button[type="submit"]');
    
    console.log('⚠️  LOGIN SELECTORS NOT IMPLEMENTED');
    console.log('TODO: Add actual DOM selectors for:');
    console.log('  1. Username field (e.g., input[name="username"])');
    console.log('  2. Password field (e.g., input[name="password"])');
    console.log('  3. Submit button (e.g., button[type="submit"])');
    
    // Wait for login to complete
    // await page.waitForNavigation({ waitUntil: 'networkidle' });
    
    // Pre-navigate to booking page
    console.log('\n[4/5] Pre-navigating to booking page...');
    // TODO: Navigate to the tee time booking page
    // await page.goto('https://members.brsgolf.com/galgorm/teetimes', { waitUntil: 'networkidle' });
    
    // Coarse wait until near target time
    await coarseWaitUntil(targetFireTime);
    
    // Spin-wait for precise timing
    console.log('\n[5/5] Executing precise timing...');
    await spinUntil(targetFireTime);
    
    // BOOKING EXECUTION
    console.log('\n🎯 ATTEMPTING BOOKING NOW!');
    const bookingStartTime = Date.now();
    
    let bookedTime = null;
    let fallbackLevel = 0;
    
    // Try each preferred time in order
    for (const [index, time] of preferredTimes.entries()) {
      try {
        console.log(`Trying time slot: ${time}`);
        
        // TODO: Replace with actual DOM selectors for time slot selection
        // Example:
        // const timeSlot = await page.$(`button[data-time="${time}"]`);
        // if (timeSlot) {
        //   await timeSlot.click();
        //   await page.click('button.confirm-booking');
        //   bookedTime = time;
        //   fallbackLevel = index;
        //   break;
        // }
        
        console.log('⚠️  BOOKING SELECTORS NOT IMPLEMENTED');
        console.log('TODO: Add actual DOM selectors for:');
        console.log(`  1. Tee time slot button for "${time}"`);
        console.log('  2. Confirm booking button');
        
        // Simulated success for testing
        if (CONFIG.DRY_RUN && index === 0) {
          bookedTime = time;
          fallbackLevel = index;
          break;
        }
        
      } catch (error) {
        console.error(`Failed to book ${time}:`, error.message);
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
        notificationBody = `Booked ${bookedTime} (fallback option ${fallbackLevel + 1})`;
      }
    } else {
      result = 'failed';
      notificationTitle = '❌ Booking Failed';
      notificationBody = 'No preferred slots were available';
    }
    
    // Save results
    await fsFinishRun(runId, {
      result,
      notes: `Completed in ${latencyMs}ms`,
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
    console.log('='.repeat(60));
    
    await browser.close();
    
    return { success: result === 'success' || result === 'fallback', result };
    
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
    
    // Compute next fire time
    const nextFireTime = computeNextFireUTC(
      job.release_day,
      job.release_time_local,
      job.tz
    );
    
    console.log(`Next booking window: ${nextFireTime.toISOString()}`);
    
    // Update job with next fire time
    await fsUpdateJob(job.id, { next_fire_time_utc: admin.firestore.Timestamp.fromDate(nextFireTime) });
    
    // Determine when to start (90 seconds before release)
    const startTime = nextFireTime.getTime() - 90000;
    const now = Date.now();
    const msUntilStart = startTime - now;
    
    if (msUntilStart > 0) {
      console.log(`Waiting ${Math.round(msUntilStart / 1000)}s until execution...`);
      await new Promise(resolve => setTimeout(resolve, msUntilStart));
    }
    
    // Execute booking
    const result = await runBooking({
      jobId: job.id,
      ownerUid: job.ownerUid,
      loginUrl: CONFIG.CLUB_LOGIN_URL,
      username: CONFIG.BRS_USERNAME,
      password: CONFIG.BRS_PASSWORD,
      preferredTimes: job.preferred_times,
      targetFireTime: nextFireTime.getTime(),
      pushToken: job.push_token,
    });
    
    console.log('\nAgent execution complete.');
    process.exit(result.success ? 0 : 1);
    
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// ========================================
// TEE TIME FETCHER (HTTP ENDPOINT)
// ========================================

import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

/**
 * Fetches available tee times for a specific date from BRS Golf
 * Uses Playwright to scrape the actual booking page
 */
async function fetchAvailableTeeTimesFromBRS(date, username, password) {
  let browser;
  
  try {
    console.log(`Fetching tee times for ${date.toISOString().split('T')[0]}...`);
    
    browser = await chromium.launch({
      headless: true,
      args: ['--disable-blink-features=AutomationControlled'],
    });
    
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      viewport: { width: 1920, height: 1080 },
    });
    
    const page = await context.newPage();
    
    // Navigate to login page
    await page.goto(CONFIG.CLUB_LOGIN_URL, { waitUntil: 'networkidle', timeout: 30000 });
    
    // TODO: Replace with actual DOM selectors for the BRS Golf site
    // Example login flow (update these selectors based on actual site):
    // await page.fill('input[name="username"]', username);
    // await page.fill('input[name="password"]', password);
    // await page.click('button[type="submit"]');
    // await page.waitForNavigation({ waitUntil: 'networkidle' });
    
    console.log('⚠️  LOGIN SELECTORS NOT IMPLEMENTED - using mock data');
    
    // Navigate to booking page for the target date
    // TODO: Update with actual booking page URL pattern
    // const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
    // await page.goto(`https://members.brsgolf.com/galgorm/teetimes?date=${dateStr}`, { waitUntil: 'networkidle' });
    
    // TODO: Extract available tee times from the page
    // Example selector (update based on actual site structure):
    // const timeSlots = await page.$$eval('.time-slot-button:not(.disabled)', (buttons) => {
    //   return buttons.map(btn => btn.getAttribute('data-time') || btn.textContent.trim());
    // });
    
    console.log('⚠️  TEE TIME EXTRACTION NOT IMPLEMENTED - returning mock data');
    
    // MOCK DATA for testing (remove when real selectors are added)
    const mockTimes = [
      '08:00', '08:10', '08:20', '08:30', '08:40', '08:50',
      '09:00', '09:10', '09:20', '09:30', '09:40', '09:50',
      '10:00', '10:10', '10:20', '10:30', '10:40', '10:50',
      '11:00', '11:10', '11:20', '11:30', '11:40', '11:50',
      '12:00', '12:10', '12:20', '12:30', '12:40', '12:50',
    ];
    
    await browser.close();
    
    console.log(`Found ${mockTimes.length} available tee times`);
    return mockTimes;
    
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
    const times = await fetchAvailableTeeTimesFromBRS(targetDate, username, password);
    
    res.json({ success: true, times });
    
  } catch (error) {
    console.error('Fetch tee times error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to fetch tee times'
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'fairway-sniper-agent' });
});

// Start HTTP server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Fairway Sniper Agent HTTP server running on port ${PORT}`);
  console.log(`   - Health: http://localhost:${PORT}/api/health`);
  console.log(`   - Fetch Tee Times: POST http://localhost:${PORT}/api/fetch-tee-times`);
});

// Run booking automation if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { runBooking, computeNextFireUTC, fsGetOneActiveJob, fetchAvailableTeeTimesFromBRS };
