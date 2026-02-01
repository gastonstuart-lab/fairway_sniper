import 'dotenv/config';
import { chromium } from '@playwright/test';
import express from 'express';
import cors from 'cors';
import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { DateTime } from 'luxon';
import * as warmSession from './warm_session.js';

// --- Release watcher: Wait for first booking link to appear ---
async function waitForBookingRelease(page, timeoutMs = 2000) {
  return await page.evaluateHandle((timeout) => {
    return new Promise((resolve) => {
      let done = false;
      const start = Date.now();
      const existing = document.querySelector('a[href*="/bookings/book"]');
      if (existing) {
        const slotText = existing.textContent || '';
        const match = slotText.match(/\b(\d{1,2}:\d{2})\b/);
        const slotTime = match ? match[1] : null;
        console.log('[SNIPER] Booking link already present; using immediate match');
        resolve({
          found: true,
          elapsedMs: 0,
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
          resolve({
            found: true,
            elapsedMs: Date.now() - start,
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
          resolve({ found: false, elapsedMs: Date.now() - start });
          observer.disconnect();
        }
      }, timeout);
    });
  }, timeoutMs).then(h => h.jsonValue ? h.jsonValue() : h);
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

// Fetch available tee times for a single date
app.post('/api/fetch-tee-times', async (req, res) => {
  let browser;
  try {
    const { date, username, password, club, reuseBrowser = true, includeUnavailable = false } = req.body || {};
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
    if (!pageMatchesDate(page, new Date(date))) {
      if (browser) await browser.close();
      return res.json({ success: true, date, count: 0, times: [], slots: [] });
    }
    const { times, slots } = await scrapeAvailableTimes(page, { includeUnavailable });

    if (browser) await browser.close();
    return res.json({ success: true, date, count: times.length, times, slots });
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
  DRY_RUN: process.argv.includes('--dry-run'),
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
    setInterval(() => {
      schedulerTick().catch((e) => console.error('[SCHEDULER] tick error:', e.message));
    }, 15000).unref?.();
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
  const bookableMap = new Map();
  const timeRegex = /\b(\d{1,2}:\d{2})\b/;
  const roots = [page];

  const extractFromButton = async (handle) => {
    try {
      return await page.evaluate((btn) => {
        const timeRegex = /\b(\d{1,2}:\d{2})\b/;
        const ignore = [
          'member',
          'format',
          'holes',
          'back',
          'nine',
          'only',
          'tee',
          'unavailable',
          'book now',
        ];
        const isName = (text) => {
          const t = text.trim();
          if (!t) return false;
          const lower = t.toLowerCase();
          if (ignore.some((w) => lower.includes(w))) return false;
          if (/\d/.test(t)) return false;
          const commaName = /^[A-Za-z][A-Za-z'\-]+,\s*[A-Za-z][A-Za-z'\-\.]+(?:\s+[A-Za-z][A-Za-z'\-\.]+)*$/.test(t);
          const spaceName = /^[A-Za-z][A-Za-z'\-]+(?:\s+[A-Za-z][A-Za-z'\-\.]+)+$/.test(t);
          return commaName || spaceName;
        };
        const normalizeName = (name) => {
          const trimmed = name.trim();
          if (!trimmed) return '';
          let normalized = trimmed;
          if (normalized.includes(',')) {
            const parts = normalized.split(',');
            const last = parts[0].trim();
            const rest = parts.slice(1).join(' ').trim();
            normalized = `${rest} ${last}`.trim();
          }
          normalized = normalized.replace(/\./g, ' ');
          const tokens = normalized.split(/\s+/).filter(Boolean);
          if (tokens.length >= 2) {
            const filtered = tokens.filter((token, idx) => {
              if (idx === 0 || idx === tokens.length - 1) return true;
              return token.length > 1;
            });
            return filtered.join(' ').toLowerCase();
          }
          return normalized.toLowerCase();
        };

        const extractNames = (text) => {
          const matches = text.match(/\b[A-Z][a-zA-Z'\-]+(?:,\s*[A-Z][a-zA-Z'\-\.]+(?:\s+[A-Z][a-zA-Z'\-\.]+)*)?\b|\b[A-Z][a-zA-Z'\-]+(?:\s+[A-Z][a-zA-Z'\-\.]+){1,3}\b/g) || [];
          return matches
            .map((m) => m.trim())
            .filter((m) => isName(m));
        };

        const extractOpenFromText = (text) => {
          if (!text) return { open: null, total: null };
          const fraction = text.match(/\b(\d+)\s*\/\s*(\d+)\b/);
          if (fraction) {
            return {
              open: parseInt(fraction[1], 10),
              total: parseInt(fraction[2], 10),
            };
          }
          const openMatch = text.match(/\b(?:only\s*)?(\d+)\s*(?:spaces?|slots?|spots?)\s*(?:left|open|available)?\b/i);
          if (openMatch) {
            return { open: parseInt(openMatch[1], 10), total: null };
          }
          return { open: null, total: null };
        };

        const extractBookedFromText = (text) => {
          if (!text) return { booked: null, total: null };
          const bookedOf = text.match(/\b(\d+)\s*of\s*(\d+)\s*booked\b/i);
          if (bookedOf) {
            return {
              booked: parseInt(bookedOf[1], 10),
              total: parseInt(bookedOf[2], 10),
            };
          }
          const bookedMatch = text.match(/\b(\d+)\s*(?:players?)\s*booked\b/i);
          if (bookedMatch) {
            return { booked: parseInt(bookedMatch[1], 10), total: null };
          }
          return { booked: null, total: null };
        };

        const attrInt = (el, keys) => {
          if (!el || !el.getAttribute) return null;
          for (const key of keys) {
            const val = el.getAttribute(key);
            if (val !== null && val !== '') {
              const n = parseInt(String(val), 10);
              if (!Number.isNaN(n)) return n;
            }
          }
          return null;
        };

        const attrIntFromTree = (root, keys) => {
          if (!root || !root.querySelector) return null;
          for (const key of keys) {
            const node = root.querySelector(`[${key}]`);
            if (node) {
              const n = attrInt(node, [key]);
              if (n !== null) return n;
            }
          }
          return null;
        };

        const stripToPlayers = (text) => {
          if (!text) return '';
          const formatIndex = text.search(/\bformat\b/i);
          if (formatIndex >= 0) return text.slice(formatIndex);
          const holeIndex = text.search(/\b(?:\d+\s*holes?|holes?|back\s+nine|front\s+nine|nine\s+only)\b/i);
          if (holeIndex >= 0) return text.slice(holeIndex);
          return text;
        };

        let container = btn.closest('tr, .tee-row, .slot-row, .timeslot, .slot, .availability, li, section, div');
        let hops = 0;
        let best = null;
        let bestNode = null;
        let bestNames = 0;
        while (container && hops < 8) {
          const text = (container.textContent || '').replace(/\s+/g, ' ').trim();
          if (timeRegex.test(text)) {
            const playerText = stripToPlayers(text);
            const names = extractNames(playerText);
            const normalizedNames = names.map(normalizeName).filter(Boolean);
            const uniqueNames = Array.from(new Set(normalizedNames));
            if (uniqueNames.length > bestNames) {
              bestNames = uniqueNames.length;
              best = { text, names: uniqueNames };
              bestNode = container;
            }
          }
          container = container.parentElement;
          hops++;
        }

        if (!best) return null;
        const match = best.text.match(timeRegex);
        if (!match) return null;
        const time = match[1];

        const playerText = stripToPlayers(best.text || '');
        const memberCount = (playerText.match(/\bmember\b/gi) || []).length;
        const guestCount = (playerText.match(/\bguest\b/gi) || []).length;
        const textCounts = extractOpenFromText(best.text || '');
        const textBooked = extractBookedFromText(best.text || '');
        const scope = bestNode || container || document;
        const bookedNodes = Array.from(scope.querySelectorAll('[data-booked]'));
        const bookedCount = bookedNodes.filter((el) => {
          const val = String(el.getAttribute('data-booked') || '').toLowerCase();
          return val === '1' || val === 'true';
        }).length;

        const openKeys = [
          'data-open-slots',
          'data-open',
          'data-available',
          'data-spaces',
          'data-spaces-available',
        ];
        const totalKeys = [
          'data-total-slots',
          'data-total',
          'data-capacity',
          'data-players',
          'data-max-players',
          'data-bookable-players-number',
        ];
        const bookedKeys = [
          'data-booked',
          'data-players-booked',
          'data-booked-count',
        ];

        const explicitTotal =
          attrInt(scope, totalKeys) ?? attrIntFromTree(scope, totalKeys) ?? textCounts.total ?? textBooked.total;
        const explicitOpen =
          attrInt(scope, openKeys) ?? attrIntFromTree(scope, openKeys) ?? textCounts.open;
        const explicitBooked =
          attrInt(scope, bookedKeys) ?? attrIntFromTree(scope, bookedKeys) ?? textBooked.booked;

        const totalSlots =
          explicitTotal ?? (bookedNodes.length > 0 ? bookedNodes.length : 4);
        const filled = explicitBooked !== null
          ? explicitBooked
          : explicitOpen !== null && totalSlots !== null
            ? Math.max(0, totalSlots - explicitOpen)
            : bookedNodes.length > 0
              ? bookedCount
              : Math.min(4, Math.max(best.names.length, memberCount + guestCount));
        const openSlots = explicitOpen !== null
          ? explicitOpen
          : totalSlots !== null
            ? Math.max(0, totalSlots - filled)
            : null;
        return { time, status: 'bookable', openSlots, totalSlots };
      }, handle);
    } catch {
      return null;
    }
  };

  const collectRows = async (root) => {
    try {
      const timeHandles = await root
        .locator('text=/\\b(?:0?\\d|1\\d|2[0-3]):[0-5]\\d\\b/')
        .elementHandles();

      for (const handle of timeHandles) {
        const row = await handle.evaluate((timeEl, opts) => {
          const { includeUnavailable } = opts || {};
          const timeRegex = /\b(\d{1,2}:\d{2})\b/;
          const ignore = [
            'member',
            'format',
            'holes',
            'back',
            'nine',
            'only',
            'tee',
            'unavailable',
            'book now',
          ];

          const isName = (text) => {
            const t = text.trim();
            if (!t) return false;
            const lower = t.toLowerCase();
            if (ignore.some((w) => lower.includes(w))) return false;
            if (/\d/.test(t)) return false;
            const commaName = /^[A-Za-z][A-Za-z'\-]+,\s*[A-Za-z][A-Za-z'\-\.]+(?:\s+[A-Za-z][A-Za-z'\-\.]+)*$/.test(t);
            const spaceName = /^[A-Za-z][A-Za-z'\-]+(?:\s+[A-Za-z][A-Za-z'\-\.]+)+$/.test(t);
            return commaName || spaceName;
          };

          const normalizeName = (name) => {
            const trimmed = name.trim();
            if (!trimmed) return '';
            let normalized = trimmed;
            if (normalized.includes(',')) {
              const parts = normalized.split(',');
              const last = parts[0].trim();
              const rest = parts.slice(1).join(' ').trim();
              normalized = `${rest} ${last}`.trim();
            }
            normalized = normalized.replace(/\./g, ' ');
            const tokens = normalized.split(/\s+/).filter(Boolean);
            if (tokens.length >= 2) {
              const filtered = tokens.filter((token, idx) => {
                if (idx === 0 || idx === tokens.length - 1) return true;
                return token.length > 1;
              });
              return filtered.join(' ').toLowerCase();
            }
            return normalized.toLowerCase();
          };

          const extractNames = (text) => {
            const matches =
              text.match(/\b[A-Z][a-zA-Z'\-]+(?:,\s*[A-Z][a-zA-Z'\-\.]+(?:\s+[A-Z][a-zA-Z'\-\.]+)*)?\b|\b[A-Z][a-zA-Z'\-]+(?:\s+[A-Z][a-zA-Z'\-\.]+){1,3}\b/g) || [];
            return matches.map((m) => m.trim()).filter((m) => isName(m));
          };

          const extractOpenFromText = (text) => {
            if (!text) return { open: null, total: null };
            const fraction = text.match(/\b(\d+)\s*\/\s*(\d+)\b/);
            if (fraction) {
              return {
                open: parseInt(fraction[1], 10),
                total: parseInt(fraction[2], 10),
              };
            }
            const openMatch = text.match(/\b(?:only\s*)?(\d+)\s*(?:spaces?|slots?|spots?)\s*(?:left|open|available)?\b/i);
            if (openMatch) {
              return { open: parseInt(openMatch[1], 10), total: null };
            }
            return { open: null, total: null };
          };

          const extractBookedFromText = (text) => {
            if (!text) return { booked: null, total: null };
            const bookedOf = text.match(/\b(\d+)\s*of\s*(\d+)\s*booked\b/i);
            if (bookedOf) {
              return {
                booked: parseInt(bookedOf[1], 10),
                total: parseInt(bookedOf[2], 10),
              };
            }
            const bookedMatch = text.match(/\b(\d+)\s*(?:players?)\s*booked\b/i);
            if (bookedMatch) {
              return { booked: parseInt(bookedMatch[1], 10), total: null };
            }
            return { booked: null, total: null };
          };

          const stripToPlayers = (text) => {
            if (!text) return '';
            const formatIndex = text.search(/\bformat\b/i);
            if (formatIndex >= 0) return text.slice(formatIndex);
            const holeIndex = text.search(/\b(?:\d+\s*holes?|holes?|back\s+nine|front\s+nine|nine\s+only)\b/i);
            if (holeIndex >= 0) return text.slice(holeIndex);
            return text;
          };

          const attrInt = (el, keys) => {
            if (!el || !el.getAttribute) return null;
            for (const key of keys) {
              const val = el.getAttribute(key);
              if (val !== null && val !== '') {
                const n = parseInt(String(val), 10);
                if (!Number.isNaN(n)) return n;
              }
            }
            return null;
          };

          const attrIntFromTree = (root, keys) => {
            if (!root || !root.querySelector) return null;
            for (const key of keys) {
              const node = root.querySelector(`[${key}]`);
              if (node) {
                const n = attrInt(node, [key]);
                if (n !== null) return n;
              }
            }
            return null;
          };

          const findRow = (el) => {
            let node = el;
            let hops = 0;
            let best = null;
            while (node && hops < 8) {
              const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
              if (timeRegex.test(text)) {
                best = node;
                if (node.matches && node.matches('tr, .tee-row, .slot-row, .timeslot, .slot, .availability, [role="row"]')) {
                  return node;
                }
              }
              node = node.parentElement;
              hops++;
            }
            return best;
          };

          const row = findRow(timeEl);
          if (!row) return null;
          const text = (row.textContent || '').replace(/\s+/g, ' ').trim();
          const match = text.match(timeRegex);
          if (!match) return null;
          const time = match[1];

          const buttons = Array.from(row.querySelectorAll('button, a, [role="button"]'));
          const hasBook = buttons.some((b) => /\bbook( now)?\b/i.test(b.textContent || ''));
          if (!hasBook && !includeUnavailable) return null;

          const playerText = stripToPlayers(text || '');
          const names = extractNames(playerText);
          const normalizedNames = names.map(normalizeName).filter(Boolean);
          const uniqueNames = Array.from(new Set(normalizedNames));
          const memberCount = (playerText.match(/\bmember\b/gi) || []).length;
          const guestCount = (playerText.match(/\bguest\b/gi) || []).length;
          const textCounts = extractOpenFromText(text || '');
          const textBooked = extractBookedFromText(text || '');
          const bookedNodes = Array.from(row.querySelectorAll('[data-booked]'));
          const bookedCount = bookedNodes.filter((el) => {
            const val = String(el.getAttribute('data-booked') || '').toLowerCase();
            return val === '1' || val === 'true';
          }).length;

          const openKeys = [
            'data-open-slots',
            'data-open',
            'data-available',
            'data-spaces',
            'data-spaces-available',
          ];
          const totalKeys = [
            'data-total-slots',
            'data-total',
            'data-capacity',
            'data-players',
            'data-max-players',
            'data-bookable-players-number',
          ];
          const bookedKeys = [
            'data-booked',
            'data-players-booked',
            'data-booked-count',
          ];

          const explicitTotal =
            attrInt(row, totalKeys) ?? attrIntFromTree(row, totalKeys) ?? textCounts.total ?? textBooked.total;
          const explicitOpen =
            attrInt(row, openKeys) ?? attrIntFromTree(row, openKeys) ?? textCounts.open;
          const explicitBooked =
            attrInt(row, bookedKeys) ?? attrIntFromTree(row, bookedKeys) ?? textBooked.booked;

          const totalSlots =
            explicitTotal ?? (bookedNodes.length > 0 ? bookedNodes.length : 4);
          const filled = explicitBooked !== null
            ? explicitBooked
            : explicitOpen !== null && totalSlots !== null
              ? Math.max(0, totalSlots - explicitOpen)
              : bookedNodes.length > 0
                ? bookedCount
                : Math.min(4, Math.max(uniqueNames.length, memberCount + guestCount));
          const openSlots = explicitOpen !== null
            ? explicitOpen
            : totalSlots !== null
              ? Math.max(0, totalSlots - filled)
              : null;

          const status = hasBook ? 'bookable' : 'unavailable';
          return { time, status, openSlots, totalSlots };
        }, handle, { includeUnavailable });

        if (!row) continue;
        const time = String(row.time || '').padStart(5, '0');
        if (!bookableMap.has(time)) {
          bookableMap.set(time, row);
        }
      }
    } catch (e) {
      return;
    }
  };

  // Scroll through the page to capture virtualized lists
  const scrollSteps = 10;
  const scrollBy = 900;
  for (let i = 0; i < scrollSteps; i++) {
    await collectRows(page);
    await page.evaluate((y) => window.scrollTo(0, y), i * scrollBy).catch(() => {});
    await page.waitForTimeout(250);
  }
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});

  const times = Array.from(bookableMap.keys()).sort();
  const slots = Array.from(bookableMap.values());

  if (times.length === 0) {
    return { times: [], slots: [] };
  }

  return { times, slots };
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

  // Now click Confirm button
  console.log(`  🎯 Clicking Confirm button...`);

  try {
    // Strategy 1: getByRole button with confirm text
    let confirmBtn = page
      .getByRole('button', {
        name: /confirm|book|complete|finish|final|create.*booking|proceed/i,
      })
      .first();

    let btnVisible = await confirmBtn
      .isVisible({ timeout: 3000 })
      .catch(() => false);

    // Strategy 2: Fallback locators
    if (!btnVisible) {
      confirmBtn = page
        .locator(
          'button:has-text("Confirm"), button:has-text("Book"), button:has-text("Complete")',
        )
        .first();
      btnVisible = await confirmBtn
        .isVisible({ timeout: 2000 })
        .catch(() => false);
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

async function executeReleaseBooking(page, locator, additionalPlayers, openSlots, fireTime, jobId) {
  const clickStart = Date.now();
  // Log target reached and click delta
  console.log(`[FIRE] Target reached at: ${new Date(fireTime).toISOString()}`);
  await locator.click();
  const clickDelta = Date.now() - fireTime;
  console.log(`[FIRE] Click executed delta: ${clickDelta}ms`);
  if (clickDelta > 200) {
    console.warn(`[WARN] Booking click delta >200ms: ${clickDelta}ms`);
    if (jobId) logJobEvent(jobId, `⚠️ FIRE DELTA TOO HIGH (${clickDelta}ms)`);
  }
  // Fill additional players if needed
  let playersFilled = [];
  let confirmResult = null;
  if (additionalPlayers && additionalPlayers.length > 0 && openSlots > 1) {
    confirmResult = await fillPlayersAndConfirm(page, additionalPlayers, openSlots);
    playersFilled = confirmResult.filled || [];
  } else {
    // Just click confirm if no additional players
    const confirmBtn = page.locator('button:has-text("Confirm"),input[type="submit"][value*="Confirm"]').first();
    if (await confirmBtn.isVisible().catch(() => false)) {
      await confirmBtn.click().catch(() => {});
    }
    confirmResult = { confirmationText: 'confirm-clicked', filled: [] };
  }
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
    booked = confirmationText && confirmationText !== 'confirm-button-not-found';
  }
  return { booked, confirmationText, playersFilled };
}

function normalizeTimeToHHMM(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.padStart(4, '0').slice(-4);
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
  const normalizedPreferredTimes = Array.isArray(preferredTimes) ? preferredTimes : [];
  let bookedTime = null;
  let fallbackLevel = 0;
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

    // --- PATCH: Add delay and reload before fallback scan ---
    if (useReleaseObserver) {
      console.log('[PATCH] Waiting 2 seconds and reloading tee sheet before fallback scan...');
      await page.waitForTimeout(2000);
      if (targetPlayDate) {
        const reloadUrl = teeSheetUrlForDate(targetPlayDate);
        await page.goto(reloadUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForTimeout(1000);
        console.log('[PATCH] Tee sheet reloaded for fallback scan.');
        // Force a full page reload to ensure DOM is fresh
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForTimeout(1000);
        console.log('[PATCH] Full page reload complete before fallback scan.');
      }
    }
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
    const additionalPlayers = players.slice(0, desiredAdditionalCount);
    await coarseWaitUntil(targetFireTime);
    console.log('\n[4/5] Executing precise timing...');
    await spinUntil(targetFireTime);
    const targetReachedAt = Date.now();
    let releaseResult = null;
    if (useReleaseObserver) {
      console.log('[SNIPER] Release watcher (MutationObserver) armed...');
      releaseResult = await waitForBookingRelease(page, 2000);
      if (releaseResult && releaseResult.found) {
        const detectedAt = targetReachedAt + releaseResult.elapsedMs;
        const delta = detectedAt - targetReachedAt;
        console.log(`[FIRE] Booking detected at: ${new Date(detectedAt).toISOString()}`);
        console.log(`[FIRE] Click executed delta: ${delta}ms`);
        if (delta > 200) console.warn(`[WARN] Booking click delta >200ms: ${delta}ms`);
        // Click the first booking link instantly
        const bookingLink = page.locator('a[href*="/bookings/book"]').first();
        await executeReleaseBooking(page, bookingLink, additionalPlayers, (slotsData[0]?.openSlots || 3), targetReachedAt + releaseResult.elapsedMs, jobId);
        // Confirm booking (no rescan)
        bookedTime = 'release';
        fallbackLevel = 0;
        notes.push(`Release-night booking succeeded; Detected at delta ${delta}ms`);
        await fsFinishRun(runId, {
          result: 'success',
          notes: `Release-booked; ${notes.join(' | ')}`,
          latency_ms: Date.now() - startTime,
          chosen_time: bookedTime,
          fallback_level: fallbackLevel,
        });
        await sendPushFCM('✅ Tee Time Booked!', `Successfully booked (release)`, pushToken);
        if (browser && !isWarm) await browser.close();
        return {
          success: true,
          result: 'success',
          bookedTime,
          fallbackLevel,
          latencyMs: Date.now() - startTime,
          notes: notes.join(' | '),
          playersRequested: additionalPlayers,
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
app.listen(port, () => {
  logStartupBanner(port);
});

export {
  runBooking,
  computeNextFireUTC,
  fsGetOneActiveJob,
};
