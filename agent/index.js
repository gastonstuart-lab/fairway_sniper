import 'dotenv/config';
import { chromium } from '@playwright/test';
import express from 'express';
import cors from 'cors';
import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { DateTime } from 'luxon';
import * as warmSession from './warm_session.js';
import { ensureTeeSelected } from './ensureTeeSelected.js';
import os from 'os';
import crypto from 'crypto';

// --- Release watcher: Wait for first booking link to appear AND click with latency measurement ---
async function waitForBookingRelease(page, timeoutMs = 2000, skipClick = false) {
  try {
    return await page.evaluate((args) => {
      const { timeout, skipClick } = args;
      return new Promise((resolve) => {
        let done = false;
        const existing = document.querySelector('a[href*="/bookings/book"]');
        if (existing) {
          const slotText = existing.textContent || '';
          const match = slotText.match(/\b(\d{1,2}:\d{2})\b/);
          const slotTime = match ? match[1] : null;
          console.log('[SNIPER] Booking link already present; using immediate match');
          
          // Measure and click atomically
          const tDetect = performance.now();
          if (!skipClick) existing.click();
          const tClick = performance.now();
          const fireLatencyMs = Math.round(tClick - tDetect);
          
          resolve({
            found: true,
            fireLatencyMs,
            slotTime,
            immediate: true,
          });
          return;
        }
        const observer = new MutationObserver(() => {
          if (done) return;
          const link = document.querySelector('a[href*="/bookings/book"]');
          if (link) {
            done = true;
            const slotText = link.textContent || '';
            const match = slotText.match(/\b(\d{1,2}:\d{2})\b/);
            const slotTime = match ? match[1] : null;
            
            // Measure and click atomically
            const tDetect = performance.now();
            if (!skipClick) link.click();
            const tClick = performance.now();
            const fireLatencyMs = Math.round(tClick - tDetect);
            
            resolve({
              found: true,
              fireLatencyMs,
              slotTime,
            });
            observer.disconnect();
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        // Fallback: timeout
        setTimeout(() => {
          if (!done) {
            done = true;
            resolve({ found: false, fireLatencyMs: null });
            observer.disconnect();
          }
        }, timeout);
      });
    }, { timeout: timeoutMs, skipClick });
  } catch (error) {
    const msg = error?.message || String(error);
    if (msg.includes('Execution context was destroyed')) {
      return { found: false, fireLatencyMs: null, error: 'context-destroyed' };
    }
    throw error;
  }
}
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const agentDir = path.dirname(__filename);

// === [AGENT] index.js starting (cleaned up) ===
const app = express();

app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'fairway-sniper-agent' });
});

// Warm-up endpoint for Railway cold-start mitigation
app.get('/api/warm', (req, res) => {
  res.json({ status: 'warm', timestamp: new Date().toISOString() });
});

// Debug endpoint for warm session status (must be after app is defined)
app.get('/api/warm-status', (req, res) => {
  res.json(warmSession.getWarmStatus());
});

// Self-check endpoint for diagnostics
app.get('/api/self-check', (req, res) => {
  res.json({
    file: __filename,
    cwd: process.cwd(),
    routes: listRegisteredRoutes(),
    time: new Date().toISOString(),
  });
});

app.get('/api/version', (_req, res) => {
  res.json({
    success: true,
    gitHash: DEPLOYED_GIT_HASH,
    branch: DEPLOYED_BRANCH,
    timestamp: new Date().toISOString(),
  });
});

// Fetch available tee times for a single date
app.post('/api/fetch-tee-times', async (req, res) => {
  let browser;
  try {
    const { date, username, password, club, reuseBrowser = true, includeUnavailable = false } = req.body || {};
    let tee = 1;
    if (typeof req.body.tee === 'number') tee = req.body.tee;
    else if (typeof req.query.tee === 'number') tee = req.query.tee;
    if (!date || !username || !password) {
      return res.status(400).json({ success: false, error: 'Missing date/username/password' });
    }

    let page;
    if (reuseBrowser) {
      page = await warmSession.getWarmPage(date, username, password);
    } else {
      browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
      const context = await browser.newContext();
      page = await context.newPage();
      await loginToBRS(page, CONFIG.CLUB_LOGIN_URL, username, password);
    }

    await navigateToTeeSheet(page, date, false);
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(300);
    // Ensure correct tee is selected before scraping
    try {
      await (await import('./ensureTeeSelected.js')).ensureTeeSelected(page, tee);
    } catch (err) {
      console.warn('[TEE] Failed to ensure tee selected:', err?.message || err);
    }
    if (!pageMatchesDate(page, new Date(date))) {
      if (browser) await browser.close();
      return res.json({ success: true, date, count: 0, times: [], slots: [] });
    }
    // Pass tee/date for diagnostics
    if (page && page.context) {
      if (!page.context()._dateForDiagnostics) page.context()._dateForDiagnostics = date;
      if (!page.context()._teeForDiagnostics) page.context()._teeForDiagnostics = tee;
    }
    const { times, slots, debug } = await scrapeAvailableTimes(page, { includeUnavailable });

    if (browser) await browser.close();
    const resp = { success: true, date, count: times.length, times, slots };
    if (debug) resp.debug = debug;
    return res.json(resp);
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Fetch available tee times across a range of days
app.post('/api/fetch-tee-times-range', async (req, res) => {
  let browser;
  try {
    const { startDate, days = 5, username, password, club, reuseBrowser = true } = req.body || {};
    let tee = 1;
    if (typeof req.body.tee === 'number') tee = req.body.tee;
    else if (typeof req.query.tee === 'number') tee = req.query.tee;
    if (!startDate || !username || !password) {
      return res.status(400).json({ success: false, error: 'Missing startDate/username/password' });
    }

    const start = new Date(startDate);
    if (Number.isNaN(start.getTime())) {
      return res.status(400).json({ success: false, error: 'Invalid startDate' });
    }

    let page;
    if (reuseBrowser) {
      page = await warmSession.getWarmPage(start, username, password);
    } else {
      browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
      const context = await browser.newContext();
      page = await context.newPage();
      await loginToBRS(page, CONFIG.CLUB_LOGIN_URL, username, password);
    }

    const daysInt = Math.max(1, Math.min(14, Number(days) || 5));
    const results = [];
    for (let i = 0; i < daysInt; i++) {
      const target = new Date(start);
      target.setDate(start.getDate() + i);
      await navigateToTeeSheet(page, target, false);
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(300);
      // Ensure correct tee is selected before scraping
      try {
        await (await import('./ensureTeeSelected.js')).ensureTeeSelected(page, tee);
      } catch (err) {
        console.warn('[TEE] Failed to ensure tee selected:', err?.message || err);
      }
      if (!pageMatchesDate(page, target)) {
        results.push({
          date: target.toISOString().slice(0, 10),
          times: [],
          slots: [],
        });
        continue;
      }
      const { times, slots } = await scrapeAvailableTimes(page);
      results.push({
        date: target.toISOString().slice(0, 10),
        times,
        slots,
      });
    }

    if (browser) await browser.close();
    return res.json({ success: true, days: results });
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Immediate booking endpoint (Normal mode)
app.post('/api/book-now', async (req, res) => {
  try {
    const { username, password, targetDate, preferredTimes, players = [], partySize, pushToken } = req.body || {};
    if (!username || !password || !targetDate) {
      return res.status(400).json({ success: false, error: 'Missing username/password/targetDate' });
    }

    const warmPage = await warmSession.getWarmPage(targetDate, username, password);
    const result = await runBooking({
      jobId: `book-now-${Date.now()}`,
      ownerUid: 'local',
      loginUrl: CONFIG.CLUB_LOGIN_URL,
      username,
      password,
      preferredTimes: Array.isArray(preferredTimes) ? preferredTimes : [],
      targetFireTime: Date.now() + 500,
      targetPlayDate: targetDate,
      players: Array.isArray(players) ? players : [],
      partySize,
      slotsData: [],
      warmPage,
      useReleaseObserver: false,
      pushToken,
    });

    return res.json(result);
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Player directory endpoint for Flutter app
app.post('/api/brs/player-directory', async (req, res) => {
  try {
    const { username } = req.body || {};
    const analysisPath = path.join(agentDir, 'inspection-output', 'form-analysis.json');
    const bookingFormPath = path.join(agentDir, 'inspection-output', 'booking-form.html');

    const normalizeOptLabel = (label) => String(label || '').trim().toLowerCase();
    const buildPlayer = (value, text) => ({
      name: String(text || '').trim(),
      id: String(value || '').trim(),
      type: String(value || '').trim() === '-2' ? 'guest' : 'member',
    });

    const parseOptions = (block) => {
      const optionRegex = /<option[^>]*value="([^"]*)"[^>]*>([^<]*)<\/option>/gi;
      const list = [];
      let opt;
      while ((opt = optionRegex.exec(block)) !== null) {
        const value = opt[1];
        const text = opt[2];
        if (!value || !text) continue;
        if (String(value).trim() === '') continue;
        if (String(text).toLowerCase().includes('start typing')) continue;
        list.push(buildPlayer(value, text));
      }
      return list;
    };

    let categories = [];
    let players = [];
    let currentUser = null;

    if (fs.existsSync(bookingFormPath)) {
      const html = await fs.promises.readFile(bookingFormPath, 'utf8');
      const currentMemberMatch = html.match(
        /id="current-member-id"[^>]*data-member-id="([^"]+)"/i
      );
      const currentMemberId = currentMemberMatch ? String(currentMemberMatch[1]).trim() : null;

      const selectMatch =
        html.match(
          /<select[^>]*id="member_booking_form_player_3"[^>]*>([\s\S]*?)<\/select>/i
        ) ||
        html.match(
          /<select[^>]*id="member_booking_form_player_4"[^>]*>([\s\S]*?)<\/select>/i
        );

      if (selectMatch) {
        const selectHtml = selectMatch[1];
        const optgroupRegex = /<optgroup[^>]*label="([^"]+)"[^>]*>([\s\S]*?)<\/optgroup>/gi;
        let groupMatch;
        const groupCategories = [];

        while ((groupMatch = optgroupRegex.exec(selectHtml)) !== null) {
          const label = groupMatch[1];
          const block = groupMatch[2];
          const groupPlayers = parseOptions(block);
          if (groupPlayers.length === 0) continue;

          const lower = normalizeOptLabel(label);
          let name = String(label).trim();
          if (lower.includes('budd')) name = 'You and your buddies';
          else if (lower.includes('general')) name = 'Guests';
          else if (lower.includes('other')) name = 'Members';
          else if (lower.includes('member')) name = 'Members';

          groupCategories.push({ name, players: groupPlayers });
          players = players.concat(groupPlayers);
        }

        if (groupCategories.length > 0) {
          categories = groupCategories;
          if (currentMemberId) {
            currentUser = players.find((p) => p.id === currentMemberId) || null;
          }
        }
      }
    }

    if (categories.length === 0) {
      if (!fs.existsSync(analysisPath)) {
        return res.status(404).json({ success: false, error: 'player-directory-not-found' });
      }

      const raw = await fs.promises.readFile(analysisPath, 'utf8');
      const data = JSON.parse(raw);
      const selects = Array.isArray(data?.selectElements) ? data.selectElements : [];
      let options = [];
      for (const sel of selects) {
        if (sel?.id && String(sel.id).includes('member_booking_form_player_')) {
          const opts = Array.isArray(sel.options) ? sel.options : [];
          if (opts.length > options.length) options = opts;
        }
      }

      players = options
        .filter((o) => o && o.value !== '' && o.text)
        .map((o) => buildPlayer(o.value, o.text));

      currentUser = players.find((p) => p.id === String(username)) || null;
      const guests = players.filter((p) => p.type === 'guest');
      const members = players.filter((p) => p.type === 'member' && p.id !== currentUser?.id);

      categories = [];
      if (currentUser) {
        categories.push({
          name: 'You',
          players: [currentUser],
        });
      }
      if (guests.length > 0) {
        categories.push({
          name: 'Guests',
          players: guests,
        });
      }
      categories.push({
        name: 'Members',
        players: members,
      });
    } else {
      const guests = players.filter((p) => p.type === 'guest');
      const members = players.filter((p) => p.type === 'member');
      const buddies = categories
        .filter((c) => normalizeOptLabel(c.name).includes('budd'))
        .flatMap((c) => c.players)
        .filter((p) => !currentUser || p.id !== currentUser.id);

      const finalCategories = [];
      if (currentUser) {
        finalCategories.push({ name: 'You', players: [currentUser] });
      }
      if (buddies.length > 0) {
        finalCategories.push({ name: 'You and your buddies', players: buddies });
      }
      if (guests.length > 0) {
        finalCategories.push({ name: 'Guests', players: guests });
      }
      if (members.length > 0) {
        finalCategories.push({ name: 'Members', players: members });
      }
      categories = finalCategories;
    }

    return res.json({
      success: true,
      count: players.length,
      categories,
      currentUserName: currentUser?.name ?? null,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Global safety nets to keep the process from exiting silently
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED_REJECTION', reason);
});
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT_EXCEPTION', err);
});







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
  SNIPER_RELEASE_WATCH_MS: Number.parseInt(process.env.SNIPER_RELEASE_WATCH_MS || '8000', 10),
  SNIPER_RELEASE_RETRY_COUNT: Number.parseInt(process.env.SNIPER_RELEASE_RETRY_COUNT || '2', 10),
  SNIPER_RELEASE_RETRY_RELOAD_DELAY_MS: Number.parseInt(
    process.env.SNIPER_RELEASE_RETRY_RELOAD_DELAY_MS || '750',
    10,
  ),
  SNIPER_FALLBACK_WINDOW_MINUTES: Number.parseInt(process.env.SNIPER_FALLBACK_WINDOW_MINUTES || '10', 10),
  SNIPER_FALLBACK_STEP_MINUTES: Number.parseInt(process.env.SNIPER_FALLBACK_STEP_MINUTES || '10', 10),
  DRY_RUN: process.argv.includes('--dry-run'),
  TEST_MODE: process.env.TEST_MODE === 'true',
  // Railway cold-start mitigation
  WARM_UP_WINDOW_MINUTES: Number.parseInt(process.env.WARM_UP_WINDOW_MINUTES || '5', 10),
  WARM_UP_TRIGGER_MINUTES: Number.parseInt(process.env.WARM_UP_TRIGGER_MINUTES || '3', 10),
  WARM_UP_POLL_INTERVAL_MS: Number.parseInt(process.env.WARM_UP_POLL_INTERVAL_MS || '30000', 10),
  AGENT_URL: process.env.AGENT_URL || 'https://fairwaysniper-production.up.railway.app',
};

initFirebaseAdmin();

function getGitHash() {
  try {
    const envHash = process.env.GIT_COMMIT || process.env.GIT_SHA;
    if (envHash) return String(envHash).slice(0, 12);
    return execSync('git rev-parse --short HEAD', {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

function listRegisteredRoutes() {
  const routes = new Set();
  const stack = app?._router?.stack || [];
  for (const layer of stack) {
    if (layer?.route?.path) {
      const methods = Object.keys(layer.route.methods || {})
        .map((m) => m.toUpperCase())
        .join(',');
      routes.add(`${methods} ${layer.route.path}`);
    } else if (layer?.name === 'router' && layer?.handle?.stack) {
      for (const sub of layer.handle.stack) {
        if (sub?.route?.path) {
          const methods = Object.keys(sub.route.methods || {})
            .map((m) => m.toUpperCase())
            .join(',');
          routes.add(`${methods} ${sub.route.path}`);
        }
      }
    }
  }
  return Array.from(routes.values()).sort();
}

const DEPLOYED_GIT_HASH =
    process.env.RAILWAY_GIT_COMMIT_SHA ||
    process.env.RAILWAY_GIT_SHA ||
    process.env.GIT_SHA ||
    process.env.SOURCE_VERSION ||
    getGitHash() ||
    'unknown';

const DEPLOYED_BRANCH =
    process.env.RAILWAY_GIT_BRANCH ||
    process.env.RAILWAY_GIT_REF_NAME ||
    process.env.GIT_REF_NAME ||
    process.env.GIT_BRANCH ||
    'main';

function logStartupBanner(port) {
  const expected = [
    'GET /api/health',
    'GET /api/jobs/:jobId',
    'POST /api/sniper-test',
  ];
  console.log('='.repeat(60));
  console.log('STARTUP OK');
  console.log(`File: ${__filename}`);
  console.log(`CWD: ${process.cwd()}`);
  console.log(`Node: ${process.version}`);
  console.log(`Git: ${getGitHash()}`);
  console.log(`LISTENING :${port}`);
  console.log('Routes loaded (expected):');
  expected.forEach((r) => console.log(`  - ${r}`));
  const actual = listRegisteredRoutes();
  console.log('Routes loaded (actual snapshot):');
  actual.forEach((r) => console.log(`  - ${r}`));
  console.log('='.repeat(60));
}

// ========================================
// IN-MEMORY JOB SCHEDULER (sniper test)
// ========================================

const JOB_MAX_QUEUE = 20;
const jobStore = new Map();
const jobLogPath = path.join(agentDir, 'agent_detached.log');

function logJobEvent(jobId, message) {
  const line = `[${new Date().toISOString()}] [JOB ${jobId}] ${message}\n`;
  console.log(`[JOB ${jobId}] ${message}`);
  fs.promises.appendFile(jobLogPath, line).catch(() => {});
}

function getJob(jobId) {
  return jobStore.get(jobId) || null;
}

function setJob(jobId, patch) {
  const prev = jobStore.get(jobId) || {};
  const next = {
    ...prev,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  jobStore.set(jobId, next);
  return next;
}

function parseFireTime(minutes, fireTimeUtc) {
  if (fireTimeUtc) {
    const t = new Date(fireTimeUtc).getTime();
    if (!Number.isNaN(t)) return t;
  }
  const mins = Number.isFinite(Number(minutes)) ? Number(minutes) : 4;
  return Date.now() + mins * 60 * 1000;
}

async function runSniperJob(jobId, payload) {
  const {
    username,
    password,
    targetDate,
    preferredTimes,
    players = [],
    partySize,
    fireTimeUtc,
    minutes,
  } = payload;

  const fireTime = parseFireTime(minutes, fireTimeUtc);
  setJob(jobId, {
    status: 'queued',
    scheduledFor: new Date(fireTime).toISOString(),
    payload: { targetDate, preferredTimes, players, partySize },
  });

  const delayMs = Math.max(0, fireTime - Date.now());
  logJobEvent(jobId, `Scheduled for ${new Date(fireTime).toISOString()} (in ${delayMs}ms)`);

  setTimeout(async () => {
    try {
      setJob(jobId, { status: 'running', startedAt: new Date().toISOString() });
      logJobEvent(jobId, 'Starting sniper job');

      const warmPage = await warmSession.getWarmPage(targetDate, username, password);

      const result = await runBooking({
        jobId,
        ownerUid: 'sniper-test',
        loginUrl: CONFIG.CLUB_LOGIN_URL,
        username,
        password,
        preferredTimes: Array.isArray(preferredTimes) ? preferredTimes : [],
        targetFireTime: fireTime,
        targetPlayDate: targetDate,
        players,
        partySize,
        slotsData: [],
        warmPage,
        useReleaseObserver: false,
      });

      setJob(jobId, {
        status: result?.success ? 'success' : 'failed',
        finishedAt: new Date().toISOString(),
        result,
      });
      logJobEvent(jobId, `Completed with status ${result?.success ? 'success' : 'failed'}`);
    } catch (error) {
      setJob(jobId, {
        status: 'failed',
        finishedAt: new Date().toISOString(),
        error: error?.message || String(error),
      });
      logJobEvent(jobId, `Failed: ${error?.message || error}`);
    }
  }, delayMs);
}

// Job status endpoint
app.get('/api/jobs/:jobId', (req, res) => {
  const jobId = req.params.jobId;
  const job = getJob(jobId);
  if (!job) return res.status(404).json({ error: 'job-not-found' });
  res.json(job);
});

// Sniper test endpoint
app.post('/api/sniper-test', async (req, res) => {
  try {
    if (jobStore.size >= JOB_MAX_QUEUE) {
      return res.status(429).json({ error: 'job-queue-full' });
    }
    const { username, password, targetDate, preferredTimes, players, partySize, minutes, fireTimeUtc } = req.body || {};
    if (!username || !password || !targetDate) {
      return res.status(400).json({ error: 'Missing required fields: username, password, targetDate' });
    }
    const jobId = `sniper-${Date.now()}`;
    setJob(jobId, { status: 'queued', createdAt: new Date().toISOString() });
    await runSniperJob(jobId, { username, password, targetDate, preferredTimes, players, partySize, minutes, fireTimeUtc });
    const job = getJob(jobId);
    res.json({ jobId, scheduledFor: job?.scheduledFor, status: job?.status });
  } catch (error) {
    res.status(500).json({ error: error?.message || String(error) });
  }
});

function getLondonTimeString(date) {
  return DateTime.fromJSDate(date).setZone(CONFIG.TZ_LONDON).toISO();
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

async function fsUpdateJob(jobId, patch) {
  if (!db || !jobId) return;
  try {
    await db
      .collection('jobs')
      .doc(jobId)
      .update({
        ...patch,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      });
  } catch (error) {
    console.error('Error updating job:', error);
  }
}

async function fsGetActiveSniperJobs(limit = 5) {
  if (!db) return [];
  try {
    const snapshot = await db
      .collection('jobs')
      .where('status', '==', 'active')
      .where('mode', '==', 'sniper')
      .orderBy('created_at', 'asc')
      .limit(limit)
      .get();
    if (snapshot.empty) return [];
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error('Error fetching active sniper jobs:', error);
    return [];
  }
}

const JOBS_COLLECTION = 'jobs';
const READY_JOB_STATUSES = ['active', 'queued', 'accepted', 'pending'];
const RUNNER_POLL_MS = 2000;
const AGENT_ID = `${os.hostname()}:${process.pid}`;
const jobTimers = new Map();

function makeRunId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return crypto.randomBytes(16).toString('hex');
}

function getJobStatus(job) {
  const raw = job?.status || job?.state || '';
  return String(raw || '').toLowerCase();
}

function isReadyJob(job) {
  if (!job) return false;
  const status = getJobStatus(job);
  const state = String(job.state || '').toLowerCase();
  const mode = String(job.mode || job.bookingMode || '').toLowerCase();
  if (mode && mode !== 'sniper') return false;
  if (['running', 'finished', 'error'].includes(state)) return false;
  return READY_JOB_STATUSES.includes(status);
}

function getFireTimeFromJob(job) {
  return (
    toDateMaybe(job.fireTimeUtc) ||
    toDateMaybe(job.fire_time_utc) ||
    toDateMaybe(job.release_window_start) ||
    toDateMaybe(job.next_fire_time_utc) ||
    toDateMaybe(job.nextFireTimeUtc)
  );
}

function resolveTargetPlayDate(job) {
  const direct = toDateMaybe(job.target_play_date) || toDateMaybe(job.targetPlayDate);
  if (direct) return direct;

  const targetDay = (job.target_day || job.targetDay || '').toString().trim().toLowerCase();
  const tz = job.tz || job.timezone || CONFIG.TZ_LONDON;
  const dayMap = {
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
    sunday: 7,
  };
  const targetWeekday = dayMap[targetDay];
  if (!targetWeekday) return null;

  const now = DateTime.now().setZone(tz).startOf('day');
  let candidate = now;
  const daysAhead = (targetWeekday - now.weekday + 7) % 7;
  if (daysAhead === 0) {
    candidate = now.plus({ days: 7 });
  } else {
    candidate = now.plus({ days: daysAhead });
  }
  return candidate.toJSDate();
}

async function fsClaimSniperJob(jobId) {
  if (!db) return null;
  const ref = db.collection(JOBS_COLLECTION).doc(jobId);
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const data = snap.data() || {};
      if (!isReadyJob(data)) return null;
      const existingClaim = data.claimed_by || data.claimedBy || null;
      if (existingClaim && existingClaim !== AGENT_ID) return null;
      const runId = makeRunId();
      tx.update(ref, {
        status: 'running',
        state: 'running',
        claimed_at: admin.firestore.FieldValue.serverTimestamp(),
        claimed_by: AGENT_ID,
        run_id: runId,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { id: snap.id, ...data, run_id: runId };
    });
  } catch (error) {
    console.error('Error claiming job:', error);
    return null;
  }
}

async function markJobError(jobId, message) {
  await fsUpdateJob(jobId, {
    status: 'error',
    state: 'error',
    error_message: message,
    finished_at: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function scheduleClaimedJob(job) {
  const jobId = job.id;
  if (!jobId) return;
  if (jobTimers.has(jobId)) return;

  const targetPlayDate = resolveTargetPlayDate(job);
  if (!targetPlayDate) {
    await markJobError(jobId, 'missing-target-play-date');
    return;
  }

  const fireTime = getFireTimeFromJob(job) || computeNextFireUTC(
    job.release_day || job.releaseDay,
    job.release_time_local || job.releaseTimeLocal,
    job.tz || job.timezone || CONFIG.TZ_LONDON,
  );

  const fireMs = fireTime?.getTime?.() ? fireTime.getTime() : null;
  if (!fireMs || Number.isNaN(fireMs)) {
          await markJobError(jobId, 'missing-target-play-date');
    return;
  }

  const now = Date.now();
  const delayMs = Math.max(0, fireMs - now);
  const scheduleAt = new Date(fireMs);

  console.log(`[RUNNER] Fire time resolved for ${jobId}: ${scheduleAt.toISOString()} (in ${delayMs}ms)`);

  await fsUpdateJob(jobId, {
    scheduled_for: admin.firestore.Timestamp.fromDate(scheduleAt),
    warm_state: 'warming',
  });

  let warmPage = null;
  try {
    const username = job.brs_email || job.brsEmail || job.username;
    const password = job.brs_password || job.brsPassword || job.password;
    if (!username || !password) {
      await markJobError(jobId, 'missing-credentials');
      return;
    }
    console.log(`[RUNNER] Warm start ${jobId}`);
    warmPage = await warmSession.getWarmPage(targetPlayDate, username, password);
    await fsUpdateJob(jobId, { warm_state: 'warmed' });
    console.log(`[RUNNER] Warm success ${jobId}`);
  } catch (error) {
    await fsUpdateJob(jobId, { warm_state: 'warm_error', warm_error: error?.message || String(error) });
    console.log(`[RUNNER] Warm fail ${jobId}: ${error?.message || error}`);
  }

  console.log(`[RUNNER] Scheduling run for ${jobId} in ${delayMs}ms`);
  const timeoutId = setTimeout(async () => {
    jobTimers.delete(jobId);
    try {
      const ownerUid = job.ownerUid || job.owner_uid || 'unknown';
      const username = job.brs_email || job.brsEmail || job.username;
      const password = job.brs_password || job.brsPassword || job.password;
      const preferredTimes = Array.isArray(job.preferred_times)
        ? job.preferred_times
        : Array.isArray(job.preferredTimes)
          ? job.preferredTimes
          : [];
      const players = Array.isArray(job.players) ? job.players : [];
      const partySize = typeof job.party_size === 'number' ? job.party_size : job.partySize;
      const pushToken = job.push_token || job.pushToken;
      const dryRun = job.dry_run === true || job.dryRun === true;
      const tee = typeof job.tee === 'number' ? job.tee : 1;

      console.log(`[RUNNER] runBooking start ${jobId}`);
      const result = await runBooking({
        jobId,
        ownerUid,
        loginUrl: CONFIG.CLUB_LOGIN_URL,
        username,
        password,
        preferredTimes,
        targetFireTime: fireMs,
        targetPlayDate: targetPlayDate,
        players,
        partySize,
        slotsData: [],
        warmPage,
        useReleaseObserver: true,
        pushToken,
        dryRun,
        tee,
      });

      console.log(`[RUNNER] runBooking finished ${jobId} booked=${result?.bookedTime || 'n/a'}`);
      const isSuccess = result?.success === true;
      await fsUpdateJob(jobId, {
        status: isSuccess ? 'finished' : 'error',
        state: isSuccess ? 'finished' : 'error',
        result: result?.result || (isSuccess ? 'success' : 'failed'),
        booked_time: result?.bookedTime || null,
        finished_at: admin.firestore.FieldValue.serverTimestamp(),
        error_message: isSuccess ? null : result?.error || 'clicked but no confirmation',
        click_delta_ms: result?.click_delta_ms ?? result?.clickDeltaMs ?? null,
        verification_url: result?.verification_url ?? result?.verificationUrl ?? null,
        verification_signal: result?.verification_signal ?? result?.verificationSignal ?? null,
        booking_links_count_after_click:
          result?.booking_links_count_after_click ?? result?.bookingLinksCountAfterClick ?? null,
        snapshot_path: result?.snapshotPath ?? result?.snapshot_path ?? null,
        release_detect_delta_ms:
          result?.release_detect_delta_ms ?? result?.releaseDetectDeltaMs ?? null,
      });
    } catch (error) {
      console.log(`[RUNNER] runBooking error ${jobId}: ${error?.message || error}`);
      await markJobError(jobId, error?.message || String(error));
    }
  }, delayMs);

  jobTimers.set(jobId, timeoutId);
}

async function handleReadyJob(job) {
  if (!job?.id) return;
  console.log(`[RUNNER] Job detected ${job.id}`);
  const claimed = await fsClaimSniperJob(job.id);
  if (!claimed) return;
  console.log(`[RUNNER] Job claimed ${job.id} run_id=${claimed.run_id || 'n/a'}`);
  await scheduleClaimedJob({ ...job, ...claimed });
}

async function resumeRunningJobs() {
  if (!db) return;
  try {
    const snapshot = await db
      .collection(JOBS_COLLECTION)
      .where('status', '==', 'running')
      .where('claimed_by', '==', AGENT_ID)
      .get();
    if (snapshot.empty) return;

    const now = Date.now();
    for (const doc of snapshot.docs) {
      const job = { id: doc.id, ...doc.data() };
      const fireTime = getFireTimeFromJob(job);
      const fireMs = fireTime?.getTime?.() ? fireTime.getTime() : null;
      if (fireMs && fireMs > now) {
        await scheduleClaimedJob(job);
      } else {
        await markJobError(job.id, 'agent restart during run');
      }
    }
  } catch (error) {
    console.error('Error resuming running jobs:', error);
  }
}

// ========================================
// RAILWAY COLD-START MITIGATION
// ========================================

async function warmUpSchedulerTick() {
  if (!db) return;
  
  try {
    const now = Date.now();
    const windowStart = now;
    const windowEnd = now + CONFIG.WARM_UP_WINDOW_MINUTES * 60 * 1000;
    
    // Query jobs with fireTime in the next 5 minutes
    const snapshot = await db
      .collection('jobs')
      .where('mode', '==', 'sniper')
      .where('status', 'in', ['active', 'ready', 'claimed', 'running'])
      .get();
    
    if (snapshot.empty) return;
    
    for (const doc of snapshot.docs) {
      const job = { id: doc.id, ...doc.data() };
      const fireTime = getFireTimeFromJob(job);
      if (!fireTime) continue;
      
      const fireMs = fireTime.getTime();
      const minutesUntilFire = (fireMs - now) / 60000;
      
      // Check if within warm-up window and trigger threshold
      if (minutesUntilFire > 0 && minutesUntilFire <= CONFIG.WARM_UP_WINDOW_MINUTES) {
        const warmedAt = job.warmed_at || job.warmedAt;
        const alreadyWarmed = warmedAt && (now - toDateMaybe(warmedAt)?.getTime()) < 5 * 60 * 1000;
        
        if (!alreadyWarmed && minutesUntilFire <= CONFIG.WARM_UP_TRIGGER_MINUTES) {
          const runId = job.run_id || job.runId || 'pending';
          console.log(`[WARM-UP] 🔥 Job detected: ${job.id} | runId: ${runId} | fireTime: ${fireTime.toISOString()} | T-${minutesUntilFire.toFixed(2)}min`);
          
          // Self-ping to wake Railway service
          const pingStart = Date.now();
          try {
            const warmUrl = `${CONFIG.AGENT_URL}/api/warm`;
            console.log(`[WARM-UP] 📡 Warm ping start: ${warmUrl}`);
            const response = await fetch(warmUrl, { 
              method: 'GET',
              signal: AbortSignal.timeout(5000)
            });
            const pingMs = Date.now() - pingStart;
            
            if (response.ok) {
              console.log(`[WARM-UP] ✅ Warm ping success (${pingMs}ms)`);
            } else {
              console.warn(`[WARM-UP] ⚠️ Warm ping returned ${response.status} (${pingMs}ms)`);
            }
          } catch (fetchErr) {
            const pingMs = Date.now() - pingStart;
            console.error(`[WARM-UP] ❌ Warm ping failed (${pingMs}ms):`, fetchErr.message);
          }
          
          // Optionally preload tee sheet (warm browser session)
          const targetPlayDate = toDateMaybe(job.target_play_date) || toDateMaybe(job.targetPlayDate);
          const username = job.brs_email || job.brsEmail || job.username;
          const password = job.brs_password || job.brsPassword || job.password;
          
          if (targetPlayDate && username && password) {
            const preloadStart = Date.now();
            try {
              console.log(`[WARM-UP] 🌐 Browser preload start for ${targetPlayDate.toISOString().slice(0, 10)}`);
              await warmSession.getWarmPage(targetPlayDate, username, password);
              const preloadMs = Date.now() - preloadStart;
              console.log(`[WARM-UP] ✅ Browser preload complete (${preloadMs}ms)`);
            } catch (warmErr) {
              const preloadMs = Date.now() - preloadStart;
              console.warn(`[WARM-UP] ⚠️ Browser preload failed (${preloadMs}ms):`, warmErr.message);
            }
          }
          
          // Mark as warmed in Firestore
          await fsUpdateJob(job.id, {
            warmed_at: admin.firestore.FieldValue.serverTimestamp()
          });
          console.log(`[WARM-UP] ✅ Job ${job.id} marked as warmed`);
        } else if (alreadyWarmed) {
          console.log(`[WARM-UP] ⏭️ Job ${job.id} already warmed (T-${minutesUntilFire.toFixed(2)}min)`);
        }
      }
    }
  } catch (error) {
    console.error('[WARM-UP] ❌ Scheduler tick error:', error.message);
  }
}

function startWarmUpScheduler() {
  if (!db) {
    console.log('[WARM-UP] Firebase Admin not configured; warm-up scheduler disabled');
    return;
  }
  
  console.log(`[WARM-UP] Scheduler started (poll every ${CONFIG.WARM_UP_POLL_INTERVAL_MS / 1000}s, trigger at T-${CONFIG.WARM_UP_TRIGGER_MINUTES}min)`);
  
  // Run initial tick
  warmUpSchedulerTick().catch((e) => console.error('[WARM-UP] Initial tick error:', e.message));
  
  // Schedule recurring ticks
  setInterval(() => {
    warmUpSchedulerTick().catch((e) => console.error('[WARM-UP] Tick error:', e.message));
  }, CONFIG.WARM_UP_POLL_INTERVAL_MS).unref?.();
}

function startSniperRunner() {
  if (!db) {
    console.log('[RUNNER] Firebase Admin not configured; runner disabled');
    return;
  }
  console.log('[RUNNER] Sniper job runner started');
  resumeRunningJobs().catch((e) => console.error('[RUNNER] resume error:', e.message));

  const query = db
    .collection(JOBS_COLLECTION)
    .where('mode', '==', 'sniper')
    .where('status', 'in', READY_JOB_STATUSES);

  try {
    query.onSnapshot((snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added' || change.type === 'modified') {
          const job = { id: change.doc.id, ...change.doc.data() };
          if (isReadyJob(job)) {
            handleReadyJob(job).catch((e) => console.error('[RUNNER] job error:', e.message));
          }
        }
      });
    }, (err) => {
      console.error('[RUNNER] onSnapshot error:', err?.message || err);
    });
  } catch (error) {
    console.error('[RUNNER] onSnapshot unavailable, falling back to polling:', error?.message || error);
    setInterval(() => {
      fsGetActiveSniperJobs(10)
        .then((jobs) => jobs.filter(isReadyJob).forEach((job) => handleReadyJob(job)))
        .catch((e) => console.error('[RUNNER] poll error:', e.message));
    }, RUNNER_POLL_MS).unref?.();
  }
}

function toDateMaybe(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value.toDate) return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function runScheduledJob(job) {
  const jobId = job.id;
  const ownerUid = job.ownerUid || job.owner_uid || 'unknown';
  const username = job.brs_email || job.brsEmail || job.username;
  const password = job.brs_password || job.brsPassword || job.password;
  const preferredTimes = Array.isArray(job.preferred_times)
    ? job.preferred_times
    : Array.isArray(job.preferredTimes)
      ? job.preferredTimes
      : [];
  const players = Array.isArray(job.players) ? job.players : [];
  const partySize = typeof job.party_size === 'number' ? job.party_size : job.partySize;
  const targetPlayDate = toDateMaybe(job.target_play_date) || toDateMaybe(job.targetPlayDate);
  const pushToken = job.push_token || job.pushToken;

  if (!username || !password || !targetPlayDate) {
    await fsUpdateJob(jobId, { status: 'failed', last_error: 'missing-credentials-or-target-date' });
    return;
  }

  await fsUpdateJob(jobId, { status: 'running', started_at: admin.firestore.FieldValue.serverTimestamp() });

  try {
    const warmPage = await warmSession.getWarmPage(targetPlayDate, username, password);
    const fireTime = Date.now();

    const result = await runBooking({
      jobId,
      ownerUid,
      loginUrl: CONFIG.CLUB_LOGIN_URL,
      username,
      password,
      preferredTimes,
      targetFireTime: fireTime,
      targetPlayDate: targetPlayDate,
      players,
      partySize,
      slotsData: [],
      warmPage,
      useReleaseObserver: false,
      pushToken,
    });

    await fsUpdateJob(jobId, {
      status: result?.success ? 'completed' : 'failed',
      last_result: result?.result || 'failed',
      last_notes: result?.notes || null,
      finished_at: admin.firestore.FieldValue.serverTimestamp(),
      next_fire_time_utc: null,
    });
  } catch (error) {
    await fsUpdateJob(jobId, {
      status: 'failed',
      last_error: error?.message || String(error),
      finished_at: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
}

async function schedulerTick() {
  const jobs = await fsGetActiveSniperJobs(5);
  if (!jobs.length) return;

  const now = Date.now();
  for (const job of jobs) {
    const nextFire = toDateMaybe(job.next_fire_time_utc) || toDateMaybe(job.nextFireTimeUtc);
    const targetPlayDate = toDateMaybe(job.target_play_date) || toDateMaybe(job.targetPlayDate);

    let fireTime = nextFire;
    if (!fireTime) {
      try {
        fireTime = computeNextFireUTC(job.release_day || job.releaseDay, job.release_time_local || job.releaseTimeLocal, job.tz || job.timezone || CONFIG.TZ_LONDON);
        await fsUpdateJob(job.id, {
          next_fire_time_utc: admin.firestore.Timestamp.fromDate(fireTime),
        });
      } catch (e) {
        await fsUpdateJob(job.id, { status: 'failed', last_error: `invalid-release-window: ${e.message}` });
        continue;
      }
    }

    if (!fireTime || !targetPlayDate) continue;
    if (fireTime.getTime() <= now + 5000) {
      await runScheduledJob(job);
    }
  }
}

let schedulerRunning = false;
if (process.env.AGENT_RUN_MAIN === 'true') {
  console.log('[SCHEDULER] Background scheduler enabled');
  if (!schedulerRunning) {
    schedulerRunning = true;
    startSniperRunner();
    startWarmUpScheduler();
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
    // Succeed as soon as tee sheet rows/times render (do NOT require booking links)
    const dateHeader = page.locator('button', { hasText: /JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC/i }).first();
    const anyTime = page.locator('text=/\\b(?:0?\\d|1\\d|2[0-3]):[0-5]\\d\\b/').first();
    const anyRow = page.locator('tr').first();
    if (await dateHeader.isVisible().catch(() => false)) return true;
    if (await anyTime.isVisible().catch(() => false)) return true;
    if (await anyRow.isVisible().catch(() => false)) return true;
    await page.waitForTimeout(200);
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

function pageMatchesDate(page, date) {
  try {
    const d = date instanceof Date ? date : new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const needle = `/${y}/${m}/${day}`;
    const url = page?.url?.() || '';
    return typeof url === 'string' && url.includes(needle);
  } catch {
    return false;
  }
}

async function navigateToTeeSheet(page, date, allowHop = true) {
  const baseDate = date instanceof Date ? date : new Date(date);
  const maxHops = allowHop ? 2 : 0; // avoid hopping for availability scans

  for (let i = 0; i <= maxHops; i++) {
    const target = new Date(baseDate);
    target.setDate(baseDate.getDate() + i);
    const url = teeSheetUrlForDate(target);
    console.log(`   → Loading tee sheet ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await acceptCookies(page);

    try {
      await waitForTeeSheet(page, 15000);
      return target;
    } catch (e) {
      console.log(`   ⚠️ Tee sheet not ready on hop ${i}: ${e.message}`);
    }
  }

  throw new Error('No tee sheet detected after several day hops');
}

async function scrapeAvailableTimes(page, { includeUnavailable = false } = {}) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  // Find all rows that could contain times (broadened selectors)
  const rowHandles = await page.locator('tr, li, .tee-row, .slot-row, .timeslot, .slot, .availability, [data-testid*="tee"], [class*="tee"], [class*="time"], [class*="slot"]').elementHandles();
  const timeRegex = /\b([01]\d|2[0-3]):[0-5]\d\b/;
  const timeMap = new Map();

  for (const rowHandle of rowHandles) {
    const rowData = await rowHandle.evaluate((row) => {
      const text = (row.textContent || '').replace(/\s+/g, ' ').trim();
      const match = text.match(/\b([01]\d|2[0-3]):[0-5]\d\b/);
      if (!match) return null;
      const time = match[0];
      const hasUnavailable = /unavailable/i.test(text) || Array.from(row.querySelectorAll('button, [role="button"]')).some(b => b.textContent?.toLowerCase().includes('unavailable') || b.disabled || b.getAttribute('aria-disabled') === 'true');
      const hasBook = Array.from(row.querySelectorAll('button, a, [role="button"]')).some(b => /\bbook( now)?\b/i.test(b.textContent || '')) && !hasUnavailable;
      let state = 'unknown';
      if (hasBook) state = 'bookable';
      else if (hasUnavailable) state = 'unavailable';
      return {
        time,
        state,
        href: (hasBook && row.querySelector('a[href*="/bookings/book"]')) ? row.querySelector('a[href*="/bookings/book"]').href : null
      };
    });
    if (rowData && rowData.time) {
      const prev = timeMap.get(rowData.time);
      if (!prev || (prev.state !== 'bookable' && rowData.state === 'bookable') || (prev.state === 'unknown' && rowData.state === 'unavailable')) {
        timeMap.set(rowData.time, rowData);
      }
    }
  }

  let times = Array.from(timeMap.keys()).sort();
  let slots = Array.from(timeMap.values());

  // Fallback: if no times found, try extracting from main container text
  if (timeMap.size === 0) {
    const fallback = await page.evaluate(() => {
      let main = document.querySelector('main') || document.querySelector('[role="main"]');
      if (!main) return null;
      const text = main.textContent || '';
      const timeRegex = /\b([01]\d|2[0-3]):[0-5]\d\b/g;
      const found = Array.from(text.matchAll(timeRegex)).map(m => m[0]);
      const unique = Array.from(new Set(found));
      const unavailable = /unavailable/i.test(text);
      return unique.map(time => ({ time, state: unavailable ? 'unavailable' : 'unknown', href: null }));
    });
    if (fallback && fallback.length) {
      times = fallback.map(f => f.time).sort();
      slots = fallback;
    }
  }

  // 0-times diagnostic
  let debug = undefined;
  if (times.length === 0) {
    // Take screenshot
    const dateStr = (page.context()._dateForDiagnostics || new Date()).toISOString().slice(0, 10);
    const teeStr = (page.context()._teeForDiagnostics || 'unknown');
    const diagPath = path.join('output', 'diagnostics', `fetch-tee-times-${dateStr}-tee-${teeStr}.png`);
    await fs.promises.mkdir(path.dirname(diagPath), { recursive: true }).catch(() => {});
    await page.screenshot({ path: diagPath, fullPage: true }).catch(() => {});

    const url = page.url();
    const bodyText = await page.evaluate(() => {
      const raw = document.body?.innerText || '';
      return raw.replace(/\s+/g, ' ').trim();
    });
    const bodyTextLen = bodyText.length;
    const first300 = bodyText.slice(0, 300);

    console.log(`[0-times] URL: ${url}`);
    console.log(`[0-times] bodyTextLen: ${bodyTextLen}`);
    console.log(`[0-times] first300: ${first300}`);
    debug = { url, bodyTextLen, first300, screenshotPath: diagPath };
  }

  return { times, slots, debug };
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
async function fillPlayersAndConfirm(page, players = [], openSlots = 3, dryRun = false) {
  const result = {
    filled: [],
    skippedReason: null,
    confirmationText: null,
  };

  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page
    .waitForSelector('#member_booking_form_confirm_booking, form[name="member_booking_form"]', {
      timeout: 8000,
    })
    .catch(() => {});

  // Only try to fill as many players as slots permit (max 3 additional players = slots 2, 3, 4)
  const playersToFill = players.slice(0, Math.min(openSlots, 3));

  console.log(
    `  👥 Attempting to fill ${playersToFill.length} player(s) (${openSlots} slot(s) available)...`,
  );

  // If no additional players needed, skip directly to confirmation
  if (playersToFill.length === 0 && openSlots > 0) {
    console.log(
      `  ℹ️ Only logged-in user (Player 1) needed. Skipping player selection.`,
    );
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
            console.log(
              `    ✅ Player ${playerNum}: ${playerName} (select by id)`,
            );
            result.filled.push(playerName);
            filled = true;
          } catch (e) {
            console.log(
              `    ℹ️ Strategy 0 (select by id) failed: ${e.message.substring(0, 50)}`,
            );
          }
        }
      }

      // Strategy A: Try getByRole('combobox')
      if (!filled) {
        let combobox = null;
        try {
          combobox = page
            .getByRole('combobox', {
              name: new RegExp(`player\\s*${playerNum}`, 'i'),
            })
            .first();

          const isVisible = await combobox
            .isVisible({ timeout: 2000 })
            .catch(() => false);
          if (isVisible) {
            await combobox.click();
            await page.waitForTimeout(300);

            // Try to select by option role
            const option = page
              .getByRole('option', {
                name: new RegExp(escapeRegex(playerName), 'i'),
              })
              .first();

            if ((await option.count()) > 0) {
              await option.click();
              console.log(
                `    ✅ Player ${playerNum}: ${playerName} (combobox role)`,
              );
              result.filled.push(playerName);
              filled = true;
            } else {
              // Try typing into the combobox to search
              console.log(`    💬 Typing "${playerName}" into search...`);
              await page.keyboard.type(playerName, { delay: 30 });
              await page.waitForTimeout(400);

              const searchResult = page
                .getByRole('option', {
                  name: new RegExp(escapeRegex(playerName), 'i'),
                })
                .first();

              if ((await searchResult.count()) > 0) {
                await searchResult.click();
                console.log(
                  `    ✅ Player ${playerNum}: ${playerName} (typed search)`,
                );
                result.filled.push(playerName);
                filled = true;
              } else {
                console.log(
                  `    ⚠️ Player ${playerNum}: No match for "${playerName}"`,
                );
              }
            }
          }
        } catch (e) {
          // Strategy A failed, try next
          console.log(
            `    ℹ️ Strategy A (getByRole combobox) failed: ${e.message.substring(0, 50)}`,
          );
        }
      }

      // Strategy B: Try getByLabel
      if (!filled) {
        try {
          const label = page
            .getByLabel(new RegExp(`player\\s*${playerNum}`, 'i'))
            .first();
          const isVisible = await label
            .isVisible({ timeout: 2000 })
            .catch(() => false);

          if (isVisible) {
            await label.selectOption({ label: playerName }).catch(async () => {
              // If selectOption fails, try clicking and then option selection
              await label.click();
              await page.waitForTimeout(300);
              const option = page
                .getByRole('option', {
                  name: new RegExp(escapeRegex(playerName), 'i'),
                })
                .first();
              await option.click();
            });
            console.log(
              `    ✅ Player ${playerNum}: ${playerName} (getByLabel)`,
            );
            result.filled.push(playerName);
            filled = true;
          }
        } catch (e) {
          console.log(
            `    ℹ️ Strategy B (getByLabel) failed: ${e.message.substring(0, 50)}`,
          );
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

            if (
              text.includes(`Player ${playerNum}`) ||
              text.includes(`player ${playerNum}`)
            ) {
              const comboboxInContainer = container
                .locator('[role="combobox"]')
                .first();

              if ((await comboboxInContainer.count()) > 0) {
                await comboboxInContainer.click();
                await page.waitForTimeout(300);

                const option = page
                  .getByRole('option', {
                    name: new RegExp(escapeRegex(playerName), 'i'),
                  })
                  .first();

                if ((await option.count()) > 0) {
                  await option.click();
                  console.log(
                    `    ✅ Player ${playerNum}: ${playerName} (container search)`,
                  );
                  result.filled.push(playerName);
                  filled = true;
                  break;
                }
              }
            }
          }
        } catch (e) {
          console.log(
            `    ℹ️ Strategy C (container search) failed: ${e.message.substring(0, 50)}`,
          );
        }
      }

      if (!filled) {
        console.log(
          `    ⚠️ Player ${playerNum} field not found or player not selectable`,
        );
        // Do not fail the booking; this is expected when openSlots < required players
      }
    } catch (error) {
      console.log(`    ❌ Error filling Player ${playerNum}: ${error.message}`);
    }
  }

  if (dryRun) {
    console.log('  💤 Dry-run enabled: skipping Create Booking click');
    result.confirmationText = 'dry-run-no-confirm';
    return result;
  }

  // Now click Confirm button
  console.log(`  🎯 Clicking Confirm button...`);

  try {
    // Strategy 1: getByRole button with confirm text
    let confirmBtn = page
      .locator('#member_booking_form_confirm_booking')
      .first();

    let btnVisible = await confirmBtn
      .isVisible({ timeout: 3000 })
      .catch(() => false);

    // Strategy 2: Fallback locators
    if (!btnVisible) {
      confirmBtn = page
        .locator(
          'button#member_booking_form_confirm_booking, form[name="member_booking_form"] button[type="submit"], button:has-text("Create Booking"), button:has-text("Confirm"), button:has-text("Book"), button:has-text("Complete")',
        )
        .first();
      btnVisible = await confirmBtn
        .isVisible({ timeout: 2000 })
        .catch(() => false);
    }

    if (btnVisible) {
      await confirmBtn.scrollIntoViewIfNeeded().catch(() => {});
      await confirmBtn.click({ timeout: 5000, force: true });
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
          const isVisible = await element
            .isVisible({ timeout: 2000 })
            .catch(() => false);

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
        const bookingsHeading = page
          .getByText(/my.*bookings|your.*bookings|booked.*tee/i)
          .first();
        if ((await bookingsHeading.count()) > 0) {
          const headingText = await bookingsHeading
            .textContent()
            .catch(() => '');
          console.log(
            `    ✅ Success detected (bookings page): "${headingText}"`,
          );
          result.confirmationText = headingText;
          return result;
        }
      } catch (e) {
        // Not a bookings page
      }

      console.log(
        `    ⚠️ No success confirmation message detected, but confirm clicked`,
      );
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

async function tryBookTime(
  page,
  time,
  players = [],
  openSlots = 3,
  cachedLocator = null,
  targetFireTime = Date.now(),
  jobId = null,
) {
  // Wait for tee sheet rows to exist
  console.log(`  ⏳ Waiting for tee sheet to load...`);
  await page.waitForSelector('tr', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2000);

  const hhmm = normalizeTimeToHHMM(time);
  if (!hhmm || hhmm.length !== 4) {
    console.log(`  ❌ Invalid time format: "${time}"`);
    return { booked: false, error: 'invalid-time-format' };
  }
  const fallbackLocator = page
    .locator(`a[href*="/bookings/book/${hhmm}"]`)
    .first();
  const bookButton = cachedLocator || fallbackLocator;

  if ((await bookButton.count()) === 0) {
    const timeLabel = `${hhmm.slice(0, 2)}:${hhmm.slice(2)}`;
    console.log(`  ⚠️ No booking link found for ${time}. Trying row scan for ${timeLabel}...`);

    const rowCandidates = page.locator(
      '.tee-row, .slot-row, .timeslot, .slot, .availability, tr',
    );
    const row = rowCandidates.filter({ hasText: timeLabel }).first();
    if ((await row.count()) === 0) {
      console.log(`  ⚠️ No row found for ${timeLabel}`);
      return { booked: false, error: 'no-booking-button-found' };
    }

    const rowBookButton = row
      .locator(
        'button:has-text("Book"), a:has-text("Book"), [role="button"]:has-text("Book")',
      )
      .first();

    if ((await rowBookButton.count()) === 0) {
      console.log(`  ⚠️ No Book action found in row for ${timeLabel}`);
      return { booked: false, error: 'no-booking-button-found' };
    }

    console.log(`  📍 Clicking Book action for ${timeLabel} (row scan)...`);
    const clickTime = Date.now();
    await rowBookButton.click({ timeout: 2000 }).catch(() => {});
    console.log(`[FIRE] Click executed at: ${new Date(clickTime).toISOString()}`);
    console.log(`[FIRE] Delta ms: ${clickTime - targetFireTime}ms`);
    await page.waitForTimeout(2000);

    const confirmResult = await fillPlayersAndConfirm(page, players, openSlots);
    return {
      booked:
        confirmResult.confirmationText !== null &&
        confirmResult.confirmationText !== 'confirm-button-not-found',
      playersFilled: confirmResult.filled,
      playersRequested: players.slice(0, Math.min(openSlots, 3)),
      confirmationText: confirmResult.confirmationText,
      skippedReason: confirmResult.skippedReason,
      error:
        confirmResult.confirmationText === 'confirm-button-not-found'
          ? 'confirm-button-not-found'
          : null,
    };
  }

  const clickDeltaMs = Date.now() - targetFireTime;
  console.log(`[SNIPER] FIRE CLICK DELTA: ${clickDeltaMs}ms`);
  if (clickDeltaMs > 250) {
    console.log('⚠️ FIRE DELTA TOO HIGH');
    if (jobId) {
      logJobEvent(jobId, `⚠️ FIRE DELTA TOO HIGH (${clickDeltaMs}ms)`);
    }
  }
  console.log(`  📍 Clicking booking button for ${time}...`);
  const clickTime = Date.now();
  await bookButton.click({ timeout: 2000 }).catch(() => {});
  console.log(`[FIRE] Click executed at: ${new Date(clickTime).toISOString()}`);
  console.log(`[FIRE] Delta ms: ${clickTime - targetFireTime}ms`);
  await page.waitForTimeout(2000); // Wait for booking form to load

  // Add dialog handler to avoid freezes
  page.on('dialog', (dialog) => dialog.accept());

  // Call the unified player selection and confirmation helper
  const confirmResult = await fillPlayersAndConfirm(page, players, openSlots);

  console.log('  ✅ Clicked booking link');
  console.log('  🔍 Verification started...');
  const verification = await verifyBookingConfirmation(page, time, 10000);
  const expectedPlayersCount = players.slice(0, Math.min(openSlots, 3)).length;
  if (expectedPlayersCount > 0 && (confirmResult.filled || []).length < expectedPlayersCount) {
    verification.confirmed = false;
    verification.verificationSignal = 'players-missing';
  }
  console.log(`  🔍 Verification: URL=${verification.verificationUrl}`);
  if (verification.confirmed) {
    console.log(`  ✅ Verification success: ${verification.verificationSignal}`);
  } else {
    console.log('  ❌ Verification failed: no confirmation within 10s');
  }

  return {
    booked:
      verification.confirmed &&
      confirmResult.confirmationText !== 'confirm-button-not-found',
    playersFilled: confirmResult.filled,
    playersRequested: players.slice(0, Math.min(openSlots, 3)),
    confirmationText: confirmResult.confirmationText,
    skippedReason: confirmResult.skippedReason,
    verificationSignal: verification.verificationSignal,
    verificationUrl: verification.verificationUrl,
    bookingLinksCountAfterClick: verification.bookingLinksCountAfterClick,
    clickDeltaMs,
    error:
      !verification.confirmed
        ? 'clicked-but-no-confirmation'
        : confirmResult.confirmationText === 'confirm-button-not-found'
          ? 'confirm-button-not-found'
          : null,
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

async function executeReleaseBooking(
  page,
  locator,
  additionalPlayers,
  openSlots,
  fireTime,
  jobId,
  dryRun = false,
  skipClick = false,
  clickDeltaOverride = null,
) {
  // Click already executed in page context (skipClick=true for release mode)
  // clickDeltaOverride contains the fireLatencyMs from MutationObserver
  const fireLatencyMs = clickDeltaOverride;
  
  // TEST_MODE: return early with validation metrics (skip player fill)
  if (CONFIG.TEST_MODE) {
    console.log(`[TEST_MODE] ✅ Validation complete - skipping player fill and confirmation`);
    return { 
      booked: false, 
      confirmationText: 'TEST_MODE_VALIDATION_ONLY', 
      playersFilled: [], 
      clickDeltaMs: fireLatencyMs 
    };
  }
  
  // Always run the normal booking flow to fill players (if any) and confirm
  const confirmResult = await fillPlayersAndConfirm(page, additionalPlayers, openSlots, dryRun);
  const playersFilled = confirmResult.filled || [];
  // Wait for confirmation
  let confirmationText = confirmResult.confirmationText || '';
  let booked = false;
  try {
    const conf = await page.locator('text=/Booking confirmed|Booking Successful|Reservation Complete/i').first();
    await conf.waitFor({ state: 'visible', timeout: 5000 });
    confirmationText = await conf.textContent();
    booked = true;
  } catch {
    // fallback to whatever confirmResult gave
    booked =
      confirmationText &&
      !['confirm-button-not-found', 'confirm-clicked-no-confirmation-text'].includes(
        confirmationText,
      );
  }
  return { booked, confirmationText, playersFilled, clickDeltaMs: fireLatencyMs };
}

async function verifyBookingConfirmation(page, timeLabel, timeoutMs = 10000) {
  const start = Date.now();
  const textLocator = page
    .locator(
      'text=/Booking confirmed|Booking Successful|Reservation Complete|Booking complete|Successfully booked|Thank\s+you|Reference\s+number/i',
    )
    .first();
  const bookingsHeading = page
    .getByText(/my.*bookings|your.*bookings|booked.*tee/i)
    .first();

  const bookingFormNotice = page
    .locator('text=/Booking Details|complete your booking|minutes to complete your booking/i')
    .first();

  let verificationSignal = null;
  let verificationUrl = page.url();

  while (Date.now() - start < timeoutMs) {
    verificationUrl = page.url();
    if (await textLocator.isVisible().catch(() => false)) {
      verificationSignal = 'text';
      break;
    }

    if (await bookingsHeading.isVisible().catch(() => false)) {
      const urlNow = page.url();
      if (!urlNow.includes('/bookings/book/')) {
        verificationSignal = 'bookings-page';
        break;
      }
    }

    if (await bookingFormNotice.isVisible().catch(() => false)) {
      verificationSignal = 'booking-form';
    }

    const rowConfirmed = await page
      .evaluate((label) => {
        const timeLabel = String(label || '').trim();
        if (!timeLabel) return false;
        const rows = Array.from(
          document.querySelectorAll(
            'tr, .tee-row, .slot-row, .timeslot, .slot, .availability, [role="row"]',
          ),
        );
        for (const row of rows) {
          const text = (row.textContent || '').replace(/\s+/g, ' ').trim();
          if (!text.includes(timeLabel)) continue;
          const hasBookLink = row.querySelector('a[href*="/bookings/book"]');
          const buttonText = (row.querySelector('button,[role="button"]')?.textContent || '').toLowerCase();
          const hasBookButton = buttonText.includes('book');
          const hasBook = !!hasBookLink || hasBookButton;
          if (!hasBook && /(unavailable|booked|reserved|full)/i.test(text)) return true;
        }
        return false;
      }, timeLabel)
      .catch(() => false);

    if (rowConfirmed) {
      verificationSignal = 'row-unavailable';
      break;
    }

    await page.waitForTimeout(500);
  }

  const bookingLinksCountAfterClick = await page
    .locator('a[href*="/bookings/book"]')
    .count()
    .catch(() => null);

  const confirmed = ['text', 'bookings-page'].includes(verificationSignal);
  return {
    confirmed,
    verificationSignal,
    verificationUrl,
    bookingLinksCountAfterClick,
  };
}

async function saveHtmlSnapshot(page, label) {
  try {
    const outDir = path.join(agentDir, 'output');
    await fs.promises.mkdir(outDir, { recursive: true });
    const safe = String(label || 'booking').replace(/[^a-z0-9_-]/gi, '_');
    const fileName = `${safe}-after-click-${Date.now()}.html`;
    const filePath = path.join(outDir, fileName);
    const html = await page.content();
    await fs.promises.writeFile(filePath, html, 'utf8');
    return filePath;
  } catch {
    return null;
  }
}

function normalizeTimeToHHMM(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.padStart(4, '0').slice(-4);
}

function timeToMinutes(value) {
  const hhmm = normalizeTimeToHHMM(value);
  if (!hhmm || hhmm.length !== 4) return null;
  const hours = Number.parseInt(hhmm.slice(0, 2), 10);
  const mins = Number.parseInt(hhmm.slice(2), 10);
  if (Number.isNaN(hours) || Number.isNaN(mins)) return null;
  if (hours < 0 || hours > 23 || mins < 0 || mins > 59) return null;
  return hours * 60 + mins;
}

function minutesToHHMM(minutes) {
  const total = ((minutes % 1440) + 1440) % 1440;
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function expandPreferredTimes(preferredTimes, windowMinutes, stepMinutes) {
  const baseTimes = Array.isArray(preferredTimes) ? preferredTimes : [];
  const normalized = [];
  const seen = new Set();
  const window = Number.isFinite(windowMinutes) ? Math.max(0, windowMinutes) : 0;
  const step = Number.isFinite(stepMinutes) ? Math.max(1, stepMinutes) : 5;

  for (const time of baseTimes) {
    const baseMinutes = timeToMinutes(time);
    if (baseMinutes === null) continue;
    const offsets = [0];
    for (let delta = step; delta <= window; delta += step) {
      offsets.push(-delta, delta);
    }
    for (const offset of offsets) {
      const label = minutesToHHMM(baseMinutes + offset);
      if (!seen.has(label)) {
        seen.add(label);
        normalized.push(label);
      }
    }
  }

  return normalized;
}

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
    slotsData = [],
    warmPage = null,
    cachedSelectors = {},
    useReleaseObserver = false,
    dryRun = false,
    tee = 1,
  } = config;
  if (!username || !password) {
    throw new Error('Missing BRS credentials for booking run');
  }
  let browser;
  let page;
  let isWarm = false;
  let runId;
  const startTime = Date.now();
  const teeDate = targetPlayDate ? new Date(targetPlayDate) : new Date();
  const notes = [];
  const normalizedPreferredTimes = expandPreferredTimes(
    preferredTimes,
    CONFIG.SNIPER_FALLBACK_WINDOW_MINUTES,
    CONFIG.SNIPER_FALLBACK_STEP_MINUTES,
  );
  if (Array.isArray(preferredTimes) && preferredTimes.length > 0) {
    const expanded = normalizedPreferredTimes.join(', ');
    const original = preferredTimes.join(', ');
    if (expanded && expanded !== original) {
      console.log(`[SNIPER] Expanded preferred times: ${expanded}`);
    }
  }
  let bookedTime = null;
  let fallbackLevel = 0;
  let additionalPlayers = [];
  try {
    runId = await fsAddRun(jobId, ownerUid, new Date(), 'Booking attempt started');
    if (warmPage) {
      page = warmPage;
      browser = page.context();
      isWarm = true;
      console.log('[WARM] Using preloaded session/page; skipping login + navigation');
    } else {
      // ...existing browser launch, login, and tee sheet navigation...
    }

    // Ensure correct tee is selected before scraping
    try {
      await ensureTeeSelected(page, typeof tee === 'number' ? tee : 1);
    } catch (err) {
      console.warn('[TEE] Failed to ensure tee selected:', err?.message || err);
    }

    // --- PATCH: release-watcher retries handled after timeout ---
    const locatorCache = {};
    for (const time of normalizedPreferredTimes) {
      const hhmm = normalizeTimeToHHMM(time);
      if (!hhmm || hhmm.length !== 4) {
        console.log(`[WARN] Skipping invalid time format in preferredTimes: "${time}"`);
        continue;
      }
      const fallbackSel = `a[href*="/bookings/book/${hhmm}"]`;
      const cachedSel = cachedSelectors?.[time] || fallbackSel;
      locatorCache[time] = page.locator(cachedSel).first();
    }
    const releaseFallbackLocator = page.locator('a[href*="/bookings/book"]').first();
    const desiredAdditionalCount = typeof partySize === 'number' ? Math.max(0, partySize - 1) : players.length;
    additionalPlayers = players.slice(0, desiredAdditionalCount);
    await coarseWaitUntil(targetFireTime);
    console.log('\n[4/5] Executing precise timing...');
    await spinUntil(targetFireTime);
    const targetReachedAt = Date.now();
    let releaseResult = null;
    if (useReleaseObserver) {
      const watchMs = Number.isFinite(CONFIG.SNIPER_RELEASE_WATCH_MS)
        ? Math.max(500, CONFIG.SNIPER_RELEASE_WATCH_MS)
        : 8000;
      const retries = Number.isFinite(CONFIG.SNIPER_RELEASE_RETRY_COUNT)
        ? Math.max(0, CONFIG.SNIPER_RELEASE_RETRY_COUNT)
        : 2;
      const maxAttempts = retries + 1;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        console.log(
          `[SNIPER] Release watcher (MutationObserver) armed... attempt ${attempt}/${maxAttempts} timeout ${watchMs}ms`,
        );
        try {
          await page.waitForLoadState('domcontentloaded');
          releaseResult = await waitForBookingRelease(page, watchMs, CONFIG.TEST_MODE);
        } catch (error) {
          const msg = error?.message || String(error);
          console.warn(`[SNIPER] Release watcher error on attempt ${attempt}/${maxAttempts}: ${msg}`);
          releaseResult = null;
        }
        if (releaseResult && releaseResult.found) {
          break;
        }
        const snapshotPath = await saveHtmlSnapshot(page, runId || jobId || 'release-timeout');
        notes.push(
          `release-watcher-timeout attempt ${attempt}/${maxAttempts} snapshot=${snapshotPath || 'n/a'}`,
        );
        if (attempt < maxAttempts && targetPlayDate) {
          console.log('[SNIPER] Release watcher timeout — reloading tee sheet and retrying...');
          const reloadUrl = teeSheetUrlForDate(targetPlayDate);
          await page.goto(reloadUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
          await page.waitForTimeout(CONFIG.SNIPER_RELEASE_RETRY_RELOAD_DELAY_MS);
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
          await page.waitForTimeout(CONFIG.SNIPER_RELEASE_RETRY_RELOAD_DELAY_MS);
        }
      }
      if (releaseResult && releaseResult.found) {
        const fireLatencyMs = releaseResult.fireLatencyMs;
        console.log(`[FIRE] FIRE_LATENCY_MS=${fireLatencyMs}`);
        if (fireLatencyMs > 200) {
          console.warn(`[WARN] ⚠️ FIRE_LATENCY_MS >200ms: ${fireLatencyMs}ms`);
          if (jobId) logJobEvent(jobId, `⚠️ FIRE LATENCY HIGH (${fireLatencyMs}ms)`);
        }
        if (CONFIG.TEST_MODE) {
          console.log(`[TEST_MODE] ⚠️ Booking click executed in page context (TEST_MODE active)`);
        }
        // Click already executed in page context by waitForBookingRelease
        const clickResult = await executeReleaseBooking(
          page,
          null,
          additionalPlayers,
          slotsData[0]?.openSlots || 3,
          targetReachedAt,
          jobId,
          dryRun,
          true,
          fireLatencyMs,
        );
        if (dryRun) {
          const diagnostics = {
            fire_latency_ms: fireLatencyMs,
            verification_url: page.url(),
            verification_signal: 'dry-run',
          };
          bookedTime = releaseResult.slotTime || 'release';
          fallbackLevel = 0;
          notes.push(`Dry-run; fire_latency=${fireLatencyMs}ms`);
          await fsFinishRun(runId, {
            result: 'dry_run',
            notes: `Dry-run; ${notes.join(' | ')}`,
            latency_ms: Date.now() - startTime,
            chosen_time: bookedTime,
            fallback_level: fallbackLevel,
            ...diagnostics,
          });
          if (browser && !isWarm) await browser.close();
          return {
            success: true,
            result: 'dry_run',
            bookedTime,
            fallbackLevel,
            latencyMs: Date.now() - startTime,
            notes: notes.join(' | '),
            playersRequested: additionalPlayers,
            ...diagnostics,
          };
        }
        console.log('[SNIPER] Verification started...');
        const verification = await verifyBookingConfirmation(
          page,
          releaseResult.slotTime || 'release',
          12000,
        );
        if (
          ['confirm-button-not-found', 'confirm-clicked-no-confirmation-text'].includes(
            clickResult?.confirmationText,
          )
        ) {
          verification.confirmed = false;
          verification.verificationSignal = 'confirm-missing';
        }
        if (additionalPlayers.length > 0 && (clickResult.playersFilled || []).length < additionalPlayers.length) {
          verification.confirmed = false;
          verification.verificationSignal = 'players-missing';
        }
        console.log(`[SNIPER] Verification: URL=${verification.verificationUrl}`);

        const clickDeltaMsConfirmed = clickResult?.clickDeltaMs ?? null;
        const diagnostics = {
          click_delta_ms: clickDeltaMsConfirmed,
          release_detect_delta_ms: delta,
          verification_url: verification.verificationUrl,
          verification_signal: verification.verificationSignal,
          booking_links_count_after_click: verification.bookingLinksCountAfterClick,
        };

        if (verification.confirmed) {
          bookedTime = releaseResult.slotTime || 'release';
          fallbackLevel = 0;
          notes.push(`Release-night booking confirmed; Detected at delta ${delta}ms`);
          await fsFinishRun(runId, {
            result: 'success_confirmed',
            notes: `Release-booked; ${notes.join(' | ')}`,
            latency_ms: Date.now() - startTime,
            chosen_time: bookedTime,
            fallback_level: fallbackLevel,
            ...diagnostics,
          });
          await sendPushFCM('✅ Tee Time Booked!', `Successfully booked (release)`, pushToken);
          if (browser && !isWarm) await browser.close();
          return {
            success: true,
            result: 'success_confirmed',
            bookedTime,
            fallbackLevel,
            latencyMs: Date.now() - startTime,
            notes: notes.join(' | '),
            playersRequested: additionalPlayers,
            ...diagnostics,
          };
        }

        console.log('[SNIPER] Verification failed: no confirmation within 12s');
        const snapshotPath = await saveHtmlSnapshot(page, runId || jobId || 'release');
        await fsFinishRun(runId, {
          result: 'click_only',
          notes: `Clicked booking link but no confirmation; ${notes.join(' | ')}`,
          latency_ms: Date.now() - startTime,
          chosen_time: bookedTime,
          fallback_level: fallbackLevel,
          snapshot_path: snapshotPath,
          ...diagnostics,
        });
        if (browser && !isWarm) await browser.close();
        return {
          success: false,
          result: 'click_only',
          bookedTime: null,
          fallbackLevel,
          latencyMs: Date.now() - startTime,
          notes: 'clicked but no confirmation',
          playersRequested: additionalPlayers,
          error: 'clicked but no confirmation',
          snapshotPath,
          ...diagnostics,
        };
      } else {
        console.log('[SNIPER] Release watcher timeout — fallback to normal scan');
      }
    }
    // === FALLBACK: NORMAL PREFERRED TIMES LOOP ===
    for (const [index, time] of normalizedPreferredTimes.entries()) {
      try {
        console.log(`Trying time slot: ${time}`);
        const slotInfo = slotsData.find((s) => s.time === time);
        const openSlots = slotInfo ? slotInfo.openSlots : 3;
        const bookingResult = await tryBookTime(
          page,
          time,
          additionalPlayers,
          openSlots,
          locatorCache[time] || releaseFallbackLocator,
          targetFireTime,
          jobId,
        );
        if (bookingResult && bookingResult.booked) {
          bookedTime = time;
          fallbackLevel = index;
          notes.push(
            `Booked ${time}; Players filled: ${bookingResult.playersFilled?.join(', ') || 'none'}; Confirmation: ${bookingResult.confirmationText}`,
          );
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
    const success = !!bookedTime;
    const resultType = success
      ? fallbackLevel === 0
        ? 'success'
        : 'fallback'
      : 'failed';

    const finalNotes = notes.join(' | ') || (success ? 'booking-complete' : 'booking-failed');

    await fsFinishRun(runId, {
      result: resultType,
      notes: finalNotes,
      latency_ms: Date.now() - startTime,
      chosen_time: bookedTime,
      fallback_level: fallbackLevel,
    });

    if (success) {
      await sendPushFCM(
        '✅ Tee Time Booked!',
        `Successfully booked ${bookedTime}`,
        pushToken,
      );
    } else {
      await sendPushFCM(
        '❌ Booking Failed',
        notes.slice(-1)[0] || 'No booking slot could be booked',
        pushToken,
      );
    }

    if (browser && !isWarm) await browser.close();

    return {
      success,
      result: resultType,
      bookedTime,
      fallbackLevel,
      latencyMs: Date.now() - startTime,
      notes: finalNotes,
      playersRequested: additionalPlayers,
    };
  } catch (error) {
    const msg = `Booking run failed: ${error.message}`;
    console.error(msg);
    await fsFinishRun(runId, {
      result: 'error',
      notes: msg,
      latency_ms: Date.now() - startTime,
      chosen_time: bookedTime,
      fallback_level: fallbackLevel,
    });
    if (browser && !isWarm) await browser.close();
    return {
      success: false,
      result: 'error',
      bookedTime,
      fallbackLevel,
      latencyMs: Date.now() - startTime,
      notes: msg,
      playersRequested: additionalPlayers,
      error: error.message,
    };
  }
}

// --- Release-night helper endpoint ---
app.post('/api/release-snipe', async (req, res) => {
  try {
    const { username, password, targetDate, fireTimeUtc, preferredTimes, partySize } = req.body;
    if (!username || !password || !targetDate) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    // Default: fireTimeUtc = 1 min from now if not provided
    let fireTime = fireTimeUtc ? new Date(fireTimeUtc).getTime() : Date.now() + 60000;
    // Default: preferredTimes = []
    const times = Array.isArray(preferredTimes) ? preferredTimes : [];
    // Warm preload
    const warmPage = await warmSession.getWarmPage(targetDate, username, password);
    // Schedule fire
    const now = Date.now();
    if (fireTime > now) {
      await coarseWaitUntil(fireTime);
    }
    // Run booking with release observer
    const result = await runBooking({
      jobId: 'release-snipe-' + Date.now(),
      ownerUid: 'release-night',
      loginUrl: CONFIG.CLUB_LOGIN_URL,
      username,
      password,
      preferredTimes: times,
      targetFireTime: fireTime,
      targetPlayDate: targetDate,
      players: [],
      partySize,
      slotsData: [],
      warmPage,
      useReleaseObserver: true,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


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


// Start the Express server
const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => {
  logStartupBanner(port);
  console.log(`[BOOT] branch=${DEPLOYED_BRANCH} gitHash=${DEPLOYED_GIT_HASH}`);
});

export {
  runBooking,
  computeNextFireUTC,
  fsGetOneActiveJob,
};
