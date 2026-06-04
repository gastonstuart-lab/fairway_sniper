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
import { maybeFallbackToAltTee, selectTeeForJob } from './tee_targeting.js';
import {
  buildSlotPolicy,
  evaluateSlotCandidate,
} from './slot_policy.js';
import { getEntryOpenSlots } from './tee_data_policy.js';
import os from 'os';
import crypto from 'crypto';

// --- Release watcher: wait for an ordered preferred booking link and click with latency measurement ---
async function waitForBookingRelease(
  page,
  preferredTimesOrTimeout = [],
  timeoutMsOrSkipClick = 2000,
  skipClickMaybe = false,
  policyMaybe = {},
) {
  let preferredTimes = preferredTimesOrTimeout;
  let timeoutMs = timeoutMsOrSkipClick;
  let skipClick = skipClickMaybe;

  if (typeof preferredTimesOrTimeout === 'number') {
    preferredTimes = [];
    timeoutMs = preferredTimesOrTimeout;
    skipClick = Boolean(timeoutMsOrSkipClick);
  }

  const preferredLabels = normalizeStringList(preferredTimes)
    .map((time) => {
      const hhmm = normalizeTimeToHHMM(time);
      if (!hhmm || hhmm.length !== 4) return null;
      return `${hhmm.slice(0, 2)}:${hhmm.slice(2)}`;
    })
    .filter(Boolean);
  const targetDateCompact = compactDateKey(policyMaybe.targetDate);
  const requestedTee = parseTeeTarget(policyMaybe.tee);

  try {
    return await page.evaluate((args) => {
      const { timeout, skipClick, preferredLabels, targetDateCompact, requestedTee } = args;
      const preferredOrder = Array.from(new Set(preferredLabels || []));
      const observerStartedAt = performance.now();

      const normalizeTimeLabel = (value) => {
        const digits = String(value || '').replace(/\D/g, '');
        if (digits.length < 3 || digits.length > 4) return null;
        const hhmm = digits.padStart(4, '0').slice(-4);
        const hour = Number.parseInt(hhmm.slice(0, 2), 10);
        const minute = Number.parseInt(hhmm.slice(2), 10);
        if (
          Number.isNaN(hour) ||
          Number.isNaN(minute) ||
          hour > 23 ||
          minute > 59
        ) {
          return null;
        }
        return `${hhmm.slice(0, 2)}:${hhmm.slice(2)}`;
      };

      const extractTimeFromHref = (href) => {
        try {
          const url = new URL(href, window.location.href);
          const segments = url.pathname.split('/').filter(Boolean).reverse();
          for (const segment of segments) {
            if (!/^\d{3,4}$/.test(segment)) continue;
            const label = normalizeTimeLabel(segment);
            if (label) return label;
          }
        } catch {
          // Fall through to regex parsing below.
        }
        const match = String(href || '').match(
          /(?:\/|%2F)([01]?\d|2[0-3])([0-5]\d)(?:[/?#&]|$)/i,
        );
        return match ? normalizeTimeLabel(`${match[1]}${match[2]}`) : null;
      };

      const extractDateFromHref = (href) => {
        try {
          const url = new URL(href, window.location.href);
          const segments = url.pathname.split('/').filter(Boolean);
          for (let index = segments.length - 1; index >= 0; index -= 1) {
            if (/^\d{8}$/.test(segments[index])) return segments[index];
          }
        } catch {
          return null;
        }
        return null;
      };

      const extractTimeFromText = (element) => {
        const row = element.closest(
          'tr, .tee-row, .slot-row, .timeslot, .slot, .availability, [role="row"]',
        );
        const text = `${row?.textContent || ''} ${element.textContent || ''}`;
        const match = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
        return match ? normalizeTimeLabel(`${match[1]}${match[2]}`) : null;
      };

      const scanCandidates = () => {
        const links = Array.from(document.querySelectorAll('a[href*="/bookings/book"]'));
        return links.map((link) => {
          const href = link.href || link.getAttribute('href') || '';
          const slotTime = extractTimeFromHref(href) || extractTimeFromText(link);
          const slotDate = extractDateFromHref(href);
          return { link, href, slotTime, slotDate, tee: requestedTee };
        });
      };

      const chooseCandidate = () => {
        const candidates = scanCandidates();
        if (!candidates.length) {
          return { candidate: null, candidates, preferredIndex: null };
        }

        if (preferredOrder.length > 0) {
          for (let index = 0; index < preferredOrder.length; index += 1) {
            const preferredTime = preferredOrder[index];
            const candidate = candidates.find((entry) =>
              entry.slotTime === preferredTime &&
              (!targetDateCompact || entry.slotDate === targetDateCompact) &&
              (entry.tee === 1 || entry.tee === 10)
            );
            if (candidate) return { candidate, candidates, preferredIndex: index };
          }
          return { candidate: null, candidates, preferredIndex: null };
        }

        return { candidate: candidates[0], candidates, preferredIndex: 0 };
      };

      const buildResult = ({ candidate, candidates, preferredIndex, immediate }) => {
        const tDetect = performance.now();
        if (!skipClick) candidate.link.click();
        const tClick = performance.now();
        return {
          found: true,
          fireLatencyMs: Math.round(tClick - tDetect),
          detectDeltaMs: Math.round(tDetect - observerStartedAt),
          slotTime: candidate.slotTime,
          href: candidate.href,
          immediate,
          preferredIndex,
          candidateCount: candidates.length,
          availableTimes: candidates.map((entry) => entry.slotTime).filter(Boolean),
          slotDate: candidate.slotDate,
          tee: candidate.tee,
        };
      };

      return new Promise((resolve) => {
        let done = false;
        const immediateChoice = chooseCandidate();
        if (immediateChoice.candidate) {
          console.log('[SNIPER] Preferred booking link already present; using immediate match');
          resolve(buildResult({ ...immediateChoice, immediate: true }));
          return;
        }
        const observer = new MutationObserver(() => {
          if (done) return;
          const choice = chooseCandidate();
          if (choice.candidate) {
            done = true;
            resolve(buildResult({ ...choice, immediate: false }));
            observer.disconnect();
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        // Fallback: timeout
        setTimeout(() => {
          if (!done) {
            done = true;
            const candidates = scanCandidates();
            resolve({
              found: false,
              fireLatencyMs: null,
              candidateCount: candidates.length,
              availableTimes: candidates.map((entry) => entry.slotTime).filter(Boolean),
              preferredTimes: preferredOrder,
            });
            observer.disconnect();
          }
        }, timeout);
      });
    }, { timeout: timeoutMs, skipClick, preferredLabels, targetDateCompact, requestedTee });
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

app.get('/api/safe-mode', (_req, res) => {
  res.json({
    success: true,
    safeMode: SAFE_MODE_ENABLED,
  });
});

app.get('/api/runtime-status', (_req, res) => {
  res.json({
    success: true,
    safeMode: SAFE_MODE_ENABLED,
    firebaseAdminReady,
    firebaseAdminError,
    agentRunMain: process.env.AGENT_RUN_MAIN === 'true',
    sniperRunnerStarted,
    activeSniperTimers: jobTimers.size,
    gitHash: DEPLOYED_GIT_HASH,
    branch: DEPLOYED_BRANCH,
    time: new Date().toISOString(),
  });
});

const parseTeeMode = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  return raw === 'both' ? 'both' : 'single';
};

const parseTeeTarget = (value) => {
  if (value === 10 || String(value || '').trim() === '10') return 10;
  return 1;
};

const parseBooleanFlag = (value, fallback = false) => {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return fallback;
};

const isAdminDevToolRequest = (req) =>
  parseBooleanFlag(req?.body?.adminDevTool ?? req?.query?.adminDevTool ?? req?.headers?.['x-admin-dev-tool'], false);

const blockAccidentalLiveEndpoint = (req, res, endpointName) => {
  const dryRun = parseBooleanFlag(req?.body?.dryRun, false);
  if (dryRun || isAdminDevToolRequest(req)) return false;
  res.status(403).json({
    success: false,
    error: `${endpointName} is an admin/dev live-booking tool. Use Firestore scheduled sniper jobs for production live bookings.`,
  });
  return true;
};

const markDiagContext = (page, dateStr, tee) => {
  if (!page || !page.context) return;
  if (dateStr) page.context()._dateForDiagnostics = dateStr;
  page.context()._teeForDiagnostics = tee;
};

const TEE_ROW_SELECTOR =
  'tr, li, .tee-row, .slot-row, .timeslot, .slot, .availability, [data-testid*="tee"], [class*="tee"], [class*="time"], [class*="slot"]';
const TEE_CONTAINER_SELECTORS = [
  'table',
  '[data-testid*="tee"]',
  '[class*="tee-sheet"]',
  '.tee-sheet',
  '.slots-container',
  '.slot-list',
  '.availability',
  '.slot-grid',
  '.tee-grid',
  'section',
];
const TEE_TIME_REGEX_SOURCE = '\\b(?:[01]\\d|2[0-3]):[0-5]\\d\\b';

async function collectTeeResult(page, tee, dateStr, includeUnavailable = false) {
  try {
    await ensureTeeSelected(page, tee);
  } catch (error) {
    console.warn('[TEE] Failed to ensure tee selected:', error?.message || error);
  }
  markDiagContext(page, dateStr, tee);
  try {
    await waitForTeeRowsRendered(page);
  } catch (err) {
    console.warn('[TEE] Waiting for tee rows:', err?.message || err);
  }
  const { times, slots, debug } = await scrapeAvailableTimes(page, { includeUnavailable });
  return {
    tee,
    count: Array.isArray(times) ? times.length : 0,
    times,
    slots,
    debug,
  };
}

// Fetch available tee times for a single date
app.post('/api/fetch-tee-times', async (req, res) => {
  let browser;
  try {
    const { date, username, password, club, reuseBrowser = true } = req.body || {};
    const teeMode = parseTeeMode(req.body?.teeMode ?? req.query?.teeMode);
    const teeTarget = parseTeeTarget(
      req.body?.teeTarget ?? req.query?.teeTarget ?? req.body?.tee ?? req.query?.tee,
    );
    const includeUnavailable = parseBooleanFlag(
      req.body?.includeUnavailable ?? req.query?.includeUnavailable,
      false,
    );

    if (!date || !username || !password) {
      return res.status(400).json({ success: false, error: 'Missing date/username/password' });
    }

    let page;
    if (reuseBrowser) {
      page = await warmSession.getWarmPage(date, username, password);
    }
    if (!page) {
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
      const emptyResponse =
        teeMode === 'both'
          ? {
              success: true,
              date,
              teeMode,
              teeTarget,
              tee1: { tee: 1, count: 0, times: [], slots: [] },
              tee10: { tee: 10, count: 0, times: [], slots: [] },
            }
          : { success: true, date, teeMode, teeTarget, count: 0, times: [], slots: [] };
      return res.json(emptyResponse);
    }

    const response = {
      success: true,
      date,
      teeMode,
      teeTarget,
    };

    if (teeMode === 'both') {
      const tee1 = await collectTeeResult(page, 1, date, includeUnavailable);
      const tee10 = await collectTeeResult(page, 10, date, includeUnavailable);
      response.tee1 = tee1;
      response.tee10 = tee10;
    } else {
      const single = await collectTeeResult(page, teeTarget, date, includeUnavailable);
      response.count = single.count;
      response.times = single.times;
      response.slots = single.slots;
      if (single.debug) response.debug = single.debug;
    }

    if (browser) await browser.close();
    return res.json(response);
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
    const teeMode = parseTeeMode(req.body?.teeMode ?? req.query?.teeMode);
    const teeTarget = parseTeeTarget(
      req.body?.teeTarget ?? req.query?.teeTarget ?? req.body?.tee ?? req.query?.tee,
    );
    const includeUnavailable = parseBooleanFlag(
      req.body?.includeUnavailable ?? req.query?.includeUnavailable,
      false,
    );
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
    }
    if (!page) {
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
      const targetDate = target.toISOString().slice(0, 10);
      await navigateToTeeSheet(page, target, false);
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(300);
      if (!pageMatchesDate(page, target)) {
        const emptyEntry =
          teeMode === 'both'
            ? {
                date: targetDate,
                teeMode,
                teeTarget,
                tee1: { tee: 1, count: 0, times: [], slots: [] },
                tee10: { tee: 10, count: 0, times: [], slots: [] },
              }
            : { date: targetDate, teeMode, teeTarget, count: 0, times: [], slots: [] };
        results.push(emptyEntry);
        continue;
      }

      if (teeMode === 'both') {
        const tee1 = await collectTeeResult(page, 1, targetDate, includeUnavailable);
        const tee10 = await collectTeeResult(page, 10, targetDate, includeUnavailable);
        results.push({
          date: targetDate,
          teeMode,
          teeTarget,
          tee1,
          tee10,
        });
      } else {
        const single = await collectTeeResult(page, teeTarget, targetDate, includeUnavailable);
        const entry = {
          date: targetDate,
          teeMode,
          teeTarget,
          count: single.count,
          times: single.times,
          slots: single.slots,
        };
        if (single.debug) entry.debug = single.debug;
        results.push(entry);
      }
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
    if (blockAccidentalLiveEndpoint(req, res, '/api/book-now')) return;
    const {
      username,
      password,
      targetDate,
      preferredTimes,
      players = [],
      partySize,
      pushToken,
      teeTarget,
      tee,
      fallbackTee,
      dryRun,
    } = req.body || {};
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
      preferredTimes: normalizeStringList(preferredTimes),
      targetFireTime: Date.now() + 500,
      targetPlayDate: targetDate,
      players: Array.isArray(players) ? players : [],
      partySize,
      slotsData: [],
      warmPage,
      useReleaseObserver: false,
      pushToken,
      teeTarget: parseTeeTarget(teeTarget ?? tee),
      fallbackTee: parseBooleanFlag(fallbackTee, false),
      dryRun: parseBooleanFlag(dryRun, false),
      sourcePath: 'endpoint:/api/book-now',
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
let firebaseAdminReady = false;
let firebaseAdminError = null;
let sniperRunnerStarted = false;

function normalizeFirebasePrivateKey(value) {
  return String(value || '')
    .replace(/\\\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .trim();
}

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
          privateKey: normalizeFirebasePrivateKey(privateKey),
        }),
      });
    }
    db = admin.firestore();
    firebaseAdminReady = true;
    firebaseAdminError = null;
    console.log('✅ Firebase Admin initialized');
  } catch (error) {
    firebaseAdminReady = false;
    firebaseAdminError = error?.message || String(error);
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
  SNIPER_RELEASE_ARM_LEAD_MS: Number.parseInt(process.env.SNIPER_RELEASE_ARM_LEAD_MS || '500', 10),
  SNIPER_DIRECT_POLL_ENABLED: process.env.SNIPER_DIRECT_POLL_ENABLED !== 'false',
  SNIPER_DIRECT_POLL_MS: Number.parseInt(process.env.SNIPER_DIRECT_POLL_MS || '6500', 10),
  SNIPER_DIRECT_POLL_INTERVAL_MS: Number.parseInt(
    process.env.SNIPER_DIRECT_POLL_INTERVAL_MS || '125',
    10,
  ),
  SNIPER_DIRECT_POLL_REQUEST_TIMEOUT_MS: Number.parseInt(
    process.env.SNIPER_DIRECT_POLL_REQUEST_TIMEOUT_MS || '2500',
    10,
  ),
  SNIPER_DIRECT_POLL_MAX_IN_FLIGHT: Number.parseInt(
    process.env.SNIPER_DIRECT_POLL_MAX_IN_FLIGHT || '4',
    10,
  ),
  SNIPER_PREP_LEAD_MS: Number.parseInt(process.env.SNIPER_PREP_LEAD_MS || '240000', 10),
  SNIPER_RUNNING_RESUME_GRACE_MS: Number.parseInt(
    process.env.SNIPER_RUNNING_RESUME_GRACE_MS || '120000',
    10,
  ),
  SNIPER_FALLBACK_WINDOW_MINUTES: Number.parseInt(process.env.SNIPER_FALLBACK_WINDOW_MINUTES || '10', 10),
  SNIPER_FALLBACK_STEP_MINUTES: Number.parseInt(process.env.SNIPER_FALLBACK_STEP_MINUTES || '10', 10),
  SNIPER_NEAREST_SLOT_WINDOW_MINUTES: Number.parseInt(
    process.env.SNIPER_NEAREST_SLOT_WINDOW_MINUTES || '6',
    10,
  ),
  DRY_RUN: process.argv.includes('--dry-run'),
  TEST_MODE: process.env.TEST_MODE === 'true',
  // Railway cold-start mitigation
  WARM_UP_WINDOW_MINUTES: Number.parseInt(process.env.WARM_UP_WINDOW_MINUTES || '5', 10),
  WARM_UP_TRIGGER_MINUTES: Number.parseInt(process.env.WARM_UP_TRIGGER_MINUTES || '3', 10),
  WARM_UP_POLL_INTERVAL_MS: Number.parseInt(process.env.WARM_UP_POLL_INTERVAL_MS || '30000', 10),
  AGENT_URL: process.env.AGENT_URL || 'https://fairwaysniper-production.up.railway.app',
};

const SAFE_MODE_ENABLED = (() => {
  return false;
})();

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
  console.log('[STARTUP] Agent started');
  console.log(`[STARTUP] Health route available: http://127.0.0.1:${port}/api/health`);
  console.log(
    firebaseAdminReady
      ? '[STARTUP] Firebase connected'
      : `[STARTUP] Firebase local-only/disabled${firebaseAdminError ? `: ${firebaseAdminError}` : ''}`,
  );
  console.log(`[STARTUP] Firestore runner enabled: ${process.env.AGENT_RUN_MAIN === 'true'}`);
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
    teeTarget,
    fallbackTee = false,
    dryRun = true,
  } = payload;

  const fireTime = parseFireTime(minutes, fireTimeUtc);
  setJob(jobId, {
    status: 'queued',
    scheduledFor: new Date(fireTime).toISOString(),
    payload: { targetDate, preferredTimes, players, partySize, teeTarget, fallbackTee, dryRun },
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
        preferredTimes: normalizeStringList(preferredTimes),
        targetFireTime: fireTime,
        targetPlayDate: targetDate,
        players,
        partySize,
        slotsData: [],
        warmPage,
        useReleaseObserver: false,
        teeTarget,
        fallbackTee,
        dryRun,
        sourcePath: 'endpoint:/api/sniper-test',
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
    const { username, password, targetDate, preferredTimes, players, partySize, minutes, fireTimeUtc, teeTarget, fallbackTee } = req.body || {};
    if (!username || !password || !targetDate) {
      return res.status(400).json({ error: 'Missing required fields: username, password, targetDate' });
    }
    const jobId = `sniper-${Date.now()}`;
    setJob(jobId, { status: 'queued', createdAt: new Date().toISOString() });
    const normalizedTeeTarget = parseTeeTarget(teeTarget ?? req.body?.tee);
    const normalizedFallbackTee = parseBooleanFlag(fallbackTee, false);
    await runSniperJob(jobId, {
      username,
      password,
      targetDate,
      preferredTimes,
      players,
      partySize,
      minutes,
      fireTimeUtc,
      teeTarget: normalizedTeeTarget,
      fallbackTee: normalizedFallbackTee,
      dryRun: parseBooleanFlag(req.body?.dryRun, true),
    });
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
  if (['paused', 'draft'].includes(state)) return false;
  if (['running', 'finished', 'error'].includes(state)) return false;
  return READY_JOB_STATUSES.includes(status);
}

function isRunningSniperJob(job) {
  if (!job) return false;
  const status = getJobStatus(job);
  const state = String(job.state || '').toLowerCase();
  const mode = String(job.mode || job.bookingMode || '').toLowerCase();
  if (mode && mode !== 'sniper') return false;
  return status === 'running' || state === 'running';
}

function getFireTimeFromJob(job) {
  const targetDateKey = getTargetDateKeyFromJob(job);
  if (targetDateKey) {
    return computeReleaseFireUTCForTargetDate(
      targetDateKey,
      job.release_time_local || job.releaseTimeLocal || '19:20',
      job.tz || job.timezone || CONFIG.TZ_LONDON,
    );
  }

  return (
    toDateMaybe(job.fireTimeUtc) ||
    toDateMaybe(job.fire_time_utc) ||
    toDateMaybe(job.release_window_start) ||
    toDateMaybe(job.next_fire_time_utc) ||
    toDateMaybe(job.nextFireTimeUtc)
  );
}

function resolveTargetPlayDate(job) {
  const targetDateKey = getTargetDateKeyFromJob(job);
  if (targetDateKey) return dateFromDateKey(targetDateKey);

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

async function fsResumeRunningSniperJob(jobId) {
  if (!db) return null;
  const ref = db.collection(JOBS_COLLECTION).doc(jobId);
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const data = snap.data() || {};
      if (!isRunningSniperJob(data)) return null;
      const runId = data.run_id || data.runId || makeRunId();
      tx.update(ref, {
        claimed_at: admin.firestore.FieldValue.serverTimestamp(),
        claimed_by: AGENT_ID,
        resumed_at: admin.firestore.FieldValue.serverTimestamp(),
        resume_count: admin.firestore.FieldValue.increment(1),
        run_id: runId,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { id: snap.id, ...data, claimed_by: AGENT_ID, run_id: runId };
    });
  } catch (error) {
    console.error('Error resuming running job:', error);
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
  const prepLeadMs = Number.isFinite(CONFIG.SNIPER_PREP_LEAD_MS)
    ? Math.max(0, CONFIG.SNIPER_PREP_LEAD_MS)
    : 240000;
  const startMs = Math.max(now, fireMs - prepLeadMs);
  const delayMs = Math.max(0, startMs - now);
  const scheduleAt = new Date(fireMs);
  const targetDateKey = getTargetDateKeyFromJob(job) || normalizeDateKey(targetPlayDate);
  const preferredTimesForLog = Array.isArray(job.preferred_times)
    ? normalizeStringList(job.preferred_times)
    : normalizeStringList(job.preferredTimes ?? job.preferred_times);
  const ukNow = DateTime.now().setZone(job.tz || job.timezone || CONFIG.TZ_LONDON).toISO();

  console.log(`[RUNNER] Job found ${jobId}`);
  console.log(`[RUNNER] Target play date: ${targetDateKey}`);
  console.log(`[RUNNER] Preferred times: ${preferredTimesForLog.join(', ') || '(none)'}`);
  console.log(`[RUNNER] Fire time UTC: ${scheduleAt.toISOString()}`);
  console.log(`[RUNNER] Current UK time: ${ukNow}`);
  console.log(`[RUNNER] Fire time resolved for ${jobId}: ${scheduleAt.toISOString()}`);
  console.log(`[RUNNER] Booking prep starts at ${new Date(startMs).toISOString()} (in ${delayMs}ms; lead ${prepLeadMs}ms)`);

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
      let runJob = job;
      if (db) {
        try {
          const latestSnap = await db.collection(JOBS_COLLECTION).doc(jobId).get();
          if (latestSnap.exists) {
            runJob = { id: latestSnap.id, ...latestSnap.data() };
            console.log(`[RUNNER] Re-read latest job fields before run ${jobId}`);
          }
        } catch (latestError) {
          console.warn(`[RUNNER] Could not re-read latest job ${jobId}: ${latestError?.message || latestError}`);
        }
      }
      const ownerUid = runJob.ownerUid || runJob.owner_uid || 'unknown';
      const username = runJob.brs_email || runJob.brsEmail || runJob.username;
      const password = runJob.brs_password || runJob.brsPassword || runJob.password;
      const preferredTimes = Array.isArray(runJob.preferred_times)
        ? normalizeStringList(runJob.preferred_times)
        : normalizeStringList(runJob.preferredTimes ?? runJob.preferred_times);
      const players = Array.isArray(runJob.players) ? runJob.players : [];
      const partySize = typeof runJob.party_size === 'number' ? runJob.party_size : runJob.partySize;
      const pushToken = runJob.push_token || runJob.pushToken;
      const dryRun = runJob.dry_run === true || runJob.dryRun === true;
      const teeConfig = resolveTeeConfigFromJob(runJob, 'RUNNER');

      console.log(`[RUNNER] runBooking start ${jobId}`);
      console.log(`[RUNNER] Target play date: ${getTargetDateKeyFromJob(runJob) || targetDateKey}`);
      console.log(`[RUNNER] Requested tee: ${teeConfig.teeTarget}`);
      console.log(`[RUNNER] Preferred times: ${preferredTimes.join(', ') || '(none)'}`);
      console.log(`[RUNNER] Fire time UTC: ${scheduleAt.toISOString()}`);
      console.log(
        `[RUNNER] Tee execution: mode=${teeConfig.teeMode} target=${teeConfig.teeTarget} fallback=${teeConfig.fallbackTee}`,
      );
      const result = await runBooking({
        jobId,
        ownerUid,
        loginUrl: CONFIG.CLUB_LOGIN_URL,
        username,
        password,
        preferredTimes,
        targetFireTime: fireMs,
        targetPlayDate: resolveTargetPlayDate(runJob) || targetPlayDate,
        targetDate: getTargetDateKeyFromJob(runJob) || getTargetDateKeyFromJob(job),
        players,
        partySize,
        slotsData: [],
        warmPage,
        useReleaseObserver: true,
        pushToken,
        dryRun,
        tee: teeConfig.tee,
        teeMode: teeConfig.teeMode,
        teeTarget: teeConfig.teeTarget,
        fallbackTee: teeConfig.fallbackTee,
        sourcePath: 'firestore-runner',
      });

      console.log(
        `[RUNNER] Final result ${jobId}: success=${result?.success === true} result=${result?.result || 'n/a'} booked=${result?.bookedTime || 'n/a'} notes=${result?.notes || ''}`,
      );
      const isSuccess = result?.success === true;
      await fsUpdateJob(jobId, {
        status: isSuccess ? 'finished' : 'error',
        state: isSuccess ? 'finished' : 'error',
        result: result?.result || (isSuccess ? 'success' : 'failed'),
        booked_time: result?.bookedTime || null,
        notes: result?.notes || null,
        players_requested: result?.playersRequested || null,
        players_filled: result?.playersFilled || null,
        field_diagnostics: result?.fieldDiagnostics || null,
        candidate_diagnostics: result?.candidateDiagnostics || null,
        available_times: result?.availableTimes || null,
        tee_selected: result?.teeSelected || null,
        requested_tee: teeConfig.teeTarget,
        finished_at: admin.firestore.FieldValue.serverTimestamp(),
        error_message: isSuccess ? null : result?.error || 'clicked but no confirmation',
        click_delta_ms: result?.click_delta_ms ?? result?.clickDeltaMs ?? null,
        verification_url: result?.verification_url ?? result?.verificationUrl ?? null,
        verification_signal: result?.verification_signal ?? result?.verificationSignal ?? null,
        booking_links_count_after_click:
          result?.booking_links_count_after_click ?? result?.bookingLinksCountAfterClick ?? null,
        snapshot_path: result?.snapshotPath ?? result?.snapshot_path ?? null,
        screenshot_path: result?.screenshotPath ?? result?.screenshot_path ?? null,
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
      .where('mode', '==', 'sniper')
      .where('status', '==', 'running')
      .get();
    if (snapshot.empty) return;

    const now = Date.now();
    for (const doc of snapshot.docs) {
      const job = { id: doc.id, ...doc.data() };
      if (jobTimers.has(job.id)) continue;
      const fireTime = getFireTimeFromJob(job);
      const fireMs = fireTime?.getTime?.() ? fireTime.getTime() : null;
      if (!fireMs || Number.isNaN(fireMs)) {
        await markJobError(job.id, 'missing-fire-time-after-restart');
        continue;
      }

      const pastFireMs = now - fireMs;
      if (fireMs > now || pastFireMs <= CONFIG.SNIPER_RUNNING_RESUME_GRACE_MS) {
        const resumed = await fsResumeRunningSniperJob(job.id);
        if (!resumed) continue;
        console.log(
          `[RUNNER] Resuming running job ${job.id} claimed_by=${job.claimed_by || 'n/a'} fireTime=${fireTime.toISOString()}`,
        );
        await scheduleClaimedJob({ ...job, ...resumed });
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
          const targetPlayDate = resolveTargetPlayDate(job);
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
    sniperRunnerStarted = false;
    console.log('[RUNNER] Firebase Admin not configured; runner disabled');
    return;
  }
  sniperRunnerStarted = true;
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

function normalizeDateKey(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) return trimmed;
  }
  const d = toDateMaybe(value);
  if (!d) return null;
  return [
    d.getUTCFullYear(),
    String(d.getUTCMonth() + 1).padStart(2, '0'),
    String(d.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function getTargetDateKeyFromJob(job) {
  return normalizeDateKey(job?.target_date || job?.targetDate);
}

function resolveTeeConfigFromJob(job, contextLabel = 'RUNNER') {
  const rawTeeMode = job?.tee_mode ?? job?.teeMode;
  const rawTeeTarget = job?.tee_target ?? job?.teeTarget ?? job?.tee;
  const rawFallbackTee = job?.fallback_tee ?? job?.fallbackTee;
  const requestedTeeMode = parseTeeMode(rawTeeMode);
  const teeMode = requestedTeeMode === 'both' ? 'single' : requestedTeeMode;
  const teeTarget = parseTeeTarget(rawTeeTarget);
  const fallbackTee = parseBooleanFlag(
    rawFallbackTee,
    requestedTeeMode === 'both',
  );
  const hadExplicitTee =
    rawTeeMode !== undefined || rawTeeTarget !== undefined || rawFallbackTee !== undefined;

  if (!hadExplicitTee) {
    console.log(
      `[${contextLabel}] No tee fields on job ${job?.id || 'unknown'}; defaulting to teeMode=single teeTarget=1 fallbackTee=false`,
    );
  } else {
    console.log(
      `[${contextLabel}] Tee config job ${job?.id || 'unknown'} => requestedMode=${requestedTeeMode} effectiveMode=${teeMode} teeTarget=${teeTarget} fallbackTee=${fallbackTee}`,
    );
    if (requestedTeeMode === 'both') {
      console.log(
        `[${contextLabel}] tee_mode=both is handled as sequential fallback: primary tee ${teeTarget}, alternate only after primary fails`,
      );
    }
  }

  return { teeMode, teeTarget, fallbackTee, tee: teeTarget };
}

function dateFromDateKey(dateKey) {
  const normalized = normalizeDateKey(dateKey);
  if (!normalized) return null;
  return new Date(`${normalized}T12:00:00.000Z`);
}

function datePartsForTeeSheet(value) {
  const normalized = normalizeDateKey(value);
  if (normalized) {
    const [year, month, day] = normalized.split('-');
    return { year, month, day };
  }
  const d = value instanceof Date ? value : new Date(value);
  return {
    year: String(d.getUTCFullYear()),
    month: String(d.getUTCMonth() + 1).padStart(2, '0'),
    day: String(d.getUTCDate()).padStart(2, '0'),
  };
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

async function runScheduledJob(job) {
  const jobId = job.id;
  const ownerUid = job.ownerUid || job.owner_uid || 'unknown';
  const username = job.brs_email || job.brsEmail || job.username;
  const password = job.brs_password || job.brsPassword || job.password;
  const preferredTimes = Array.isArray(job.preferred_times)
    ? normalizeStringList(job.preferred_times)
    : normalizeStringList(job.preferredTimes ?? job.preferred_times);
  const players = Array.isArray(job.players) ? job.players : [];
  const partySize = typeof job.party_size === 'number' ? job.party_size : job.partySize;
  const targetPlayDate = resolveTargetPlayDate(job);
  const pushToken = job.push_token || job.pushToken;
  const teeConfig = resolveTeeConfigFromJob(job, 'SCHEDULER');

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
      targetDate: getTargetDateKeyFromJob(job),
      players,
      partySize,
      slotsData: [],
      warmPage,
      useReleaseObserver: false,
      pushToken,
      tee: teeConfig.tee,
      teeMode: teeConfig.teeMode,
      teeTarget: teeConfig.teeTarget,
      fallbackTee: teeConfig.fallbackTee,
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
    const targetPlayDate = resolveTargetPlayDate(job);

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

async function waitForTeeRowsRendered(page, timeoutMs = 15000) {
  await page.waitForFunction(
    ({ containerSelectors, rowSelector, timeRegexSource }) => {
      const timeRegex = new RegExp(timeRegexSource);
      const containers = [];
      for (const selector of containerSelectors) {
        const found = Array.from(document.querySelectorAll(selector));
        for (const entry of found) {
          if (entry && !containers.includes(entry)) {
            containers.push(entry);
          }
        }
      }
      if (!containers.length) return false;
      const loadingText = (document.body?.innerText || '').toLowerCase().includes('loading tee-times');
      for (const container of containers) {
        const rows = Array.from(container.querySelectorAll(rowSelector));
        if (!rows.length) continue;
        const matchCount = rows.filter((row) => timeRegex.test(row.textContent || '')).length;
        const hasMarker = rows.some((row) =>
          /\b(book( now)?|unavailable|availability)\b/i.test(row.textContent || ''),
        );
        if (matchCount >= 5) return true;
        if (hasMarker) return true;
        if (!loadingText && matchCount > 0) return true;
      }
      return false;
    },
    { containerSelectors: TEE_CONTAINER_SELECTORS, rowSelector: TEE_ROW_SELECTOR, timeRegexSource: TEE_TIME_REGEX_SOURCE },
    { timeout: timeoutMs, polling: 400 },
  );
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
  const { year, month, day } = datePartsForTeeSheet(date);
  return `https://members.brsgolf.com/galgorm/tee-sheet/1/${year}/${month}/${day}`;
}

function teeSheetDataUrlForDate(date) {
  const { year, month, day } = datePartsForTeeSheet(date);
  return `https://members.brsgolf.com/galgorm/tee-sheet/data/1/${year}/${month}/${day}?_=${Date.now()}`;
}

function pageMatchesDate(page, date) {
  try {
    const parts = datePartsForTeeSheet(date);
    const needle = `/${parts.year}/${parts.month}/${parts.day}`;
    const url = page?.url?.() || '';
    return typeof url === 'string' && url.includes(needle);
  } catch {
    return false;
  }
}

async function navigateToTeeSheet(page, date, allowHop = true) {
  const baseDate = dateFromDateKey(date) || (date instanceof Date ? date : new Date(date));
  const maxHops = allowHop ? 2 : 0; // avoid hopping for availability scans

  for (let i = 0; i <= maxHops; i++) {
    const target = new Date(baseDate);
    target.setUTCDate(baseDate.getUTCDate() + i);
    const url = teeSheetUrlForDate(target);
    console.log(`   → Loading tee sheet ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await acceptCookies(page);

    try {
      await waitForTeeSheet(page, 15000);
      console.log(`[TEE] Tee sheet date reached: ${normalizeDateKey(target) || target.toISOString().slice(0, 10)}`);
      return target;
    } catch (e) {
      console.log(`   ⚠️ Tee sheet not ready on hop ${i}: ${e.message}`);
    }
  }

  throw new Error('No tee sheet detected after several day hops');
}

async function scrapeAvailableTimes(page, { includeUnavailable = false } = {}) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(1500).catch(() => {});
  const { rows: scrapedRows = [], reason: scrapeReason = 'teeSheetContainerNotFound' } =
    await page.evaluate(
      ({ rowSelector, containerSelectors, timeRegexSource }) => {
        const gatherButtonInfo = (row) => Array.from(row.querySelectorAll('button, a, [role="button"]'));
        const containers = [];
        for (const selector of containerSelectors) {
          const found = Array.from(document.querySelectorAll(selector));
          for (const entry of found) {
            if (entry && !containers.includes(entry)) {
              containers.push(entry);
            }
          }
        }
        const timeRegex = new RegExp(timeRegexSource);
        let bestContainer = null;
        for (const container of containers) {
          if (!container) continue;
          const candidateRows = Array.from(container.querySelectorAll(rowSelector));
          if (!candidateRows.length) continue;
          if (!bestContainer) bestContainer = container;
          const matchCount = candidateRows.filter((row) => timeRegex.test(row.textContent || '')).length;
          if (matchCount >= 5) {
            bestContainer = container;
            break;
          }
        }
        if (!bestContainer) {
          return { rows: [], reason: 'teeSheetContainerNotFound' };
        }
        const candidateRows = Array.from(bestContainer.querySelectorAll(rowSelector));
        const results = [];
        for (const row of candidateRows) {
          if (!row) continue;
          const text = (row.textContent || '').replace(/\s+/g, ' ').trim();
          if (!text) continue;
          const match = text.match(new RegExp(timeRegexSource));
          if (!match) continue;
          const time = match[0];
          const buttonElements = gatherButtonInfo(row);
          const hasUnavailable =
            /unavailable/i.test(text) ||
            buttonElements.some(
              (b) =>
                (b.textContent || '').toLowerCase().includes('unavailable') ||
                b.disabled ||
                b.getAttribute('aria-disabled') === 'true',
            );
          const bookingLink = row.querySelector('a[href*="/bookings/book"]');
          const hasBook =
            (!!bookingLink ||
              buttonElements.some((b) => /\bbook( now)?\b/i.test(b.textContent || ''))) &&
            !hasUnavailable;
          let state = 'unknown';
          if (hasBook) state = 'bookable';
          else if (hasUnavailable) state = 'unavailable';
          const link = hasBook ? bookingLink : null;
          results.push({
            time,
            state,
            href: link ? link.href : null,
          });
        }
        if (!results.length) {
          const linkRows = Array.from(document.querySelectorAll('a[href*="/bookings/book"]'))
            .map((link) => {
              const row = link.closest('tr') || link.closest('li') || link.parentElement;
              const text = (row?.textContent || link.textContent || '').replace(/\s+/g, ' ').trim();
              const href = link.href || '';
              const hrefMatch = href.match(/\/(\d{4})(?:[?#]|$)/);
              const textMatch = text.match(new RegExp(timeRegexSource));
              const rawTime = textMatch?.[0] || hrefMatch?.[1] || '';
              if (!rawTime) return null;
              const time = rawTime.includes(':') ? rawTime : `${rawTime.slice(0, 2)}:${rawTime.slice(2)}`;
              const hasUnavailable = /unavailable/i.test(text);
              const linkText = (link.textContent || '').replace(/\s+/g, ' ').trim();
              const isBookable = /book/i.test(linkText) || /add-booking/i.test(link.className || '');
              if (!isBookable || hasUnavailable) return null;
              return {
                time,
                state: 'bookable',
                href,
                source: 'booking-link-fallback',
                rowText: text,
              };
            })
            .filter(Boolean);
          if (linkRows.length) return { rows: linkRows, reason: 'bookingLinkFallback' };
          return { rows: [], reason: 'teeSheetContainerNotFound' };
        }
        return { rows: results };
      },
      {
        rowSelector: TEE_ROW_SELECTOR,
        containerSelectors: TEE_CONTAINER_SELECTORS,
        timeRegexSource: TEE_TIME_REGEX_SOURCE,
      },
    );

  const timeMap = new Map();
  for (const entry of scrapedRows) {
    if (!entry?.time) continue;
    const prev = timeMap.get(entry.time);
    if (
      !prev ||
      (prev.state !== 'bookable' && entry.state === 'bookable') ||
      (prev.state === 'unknown' && entry.state === 'unavailable')
    ) {
      timeMap.set(entry.time, entry);
    }
  }

  let slots = Array.from(timeMap.values());
  slots.sort((a, b) => a.time.localeCompare(b.time));

  let times = slots.map((slot) => slot.time);


  // 0-times diagnostic
  let debug = undefined;
  if (times.length === 0) {
    const diagDateValue = page.context()._dateForDiagnostics;
    const diagDate = diagDateValue ? new Date(diagDateValue) : new Date();
    const diagIso = Number.isNaN(diagDate.getTime()) ? new Date().toISOString() : diagDate.toISOString();
    const dateStr = diagIso.slice(0, 10);
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
    let reason = scrapeReason;
    const lowerText = bodyText.toLowerCase();
    if (lowerText.includes('tee times could not be loaded')) {
      reason = 'tee sheet load error';
    } else if (lowerText.includes('loading tee-times')) {
      reason = 'tee sheet still loading';
    } else {
      reason = 'no tee rows found';
    }
    debug = {
      reason,
      url,
      bodyTextLen,
      first300,
      screenshotPath: diagPath,
    };
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
    fieldDiagnostics: [],
  };

  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page
    .waitForSelector('#member_booking_form_confirm_booking, form[name="member_booking_form"]', {
      timeout: 8000,
    })
    .catch(() => {});

  const normalizedOpenSlots = Number.isFinite(Number(openSlots))
    ? Math.max(0, Number(openSlots))
    : 3;
  if (players.length > normalizedOpenSlots) {
    console.log(
      `  ⚠️ Full party does not fit: ${players.length} additional player(s), ${normalizedOpenSlots} open slot(s).`,
    );
    result.skippedReason = 'insufficient-open-slots';
    result.confirmationText = 'insufficient-open-slots';
    return result;
  }

  // Only try to fill as many players as slots permit (max 3 additional players = slots 2, 3, 4)
  const playersToFill = players.slice(0, Math.min(normalizedOpenSlots, 3));

  console.log(
    `  👥 Attempting to fill ${playersToFill.length} player(s) (${normalizedOpenSlots} slot(s) available)...`,
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
          const fieldInfo = await selectElem
            .evaluate((el, requestedValue) => {
              const options = Array.from(el.options || []).map((option) => ({
                value: option.value,
                text: (option.textContent || '').replace(/\s+/g, ' ').trim(),
                disabled: option.disabled,
              }));
              return {
                id: el.id,
                disabled: !!el.disabled,
                visible:
                  getComputedStyle(el).display !== 'none' &&
                  getComputedStyle(el).visibility !== 'hidden',
                optionCount: options.length,
                hasRequestedValue: options.some((option) => option.value === String(requestedValue)),
                selectedValue: el.value || '',
                selectedText:
                  el.selectedOptions && el.selectedOptions[0]
                    ? (el.selectedOptions[0].textContent || '').replace(/\s+/g, ' ').trim()
                    : '',
              };
            }, playerName)
            .catch((error) => ({ error: error?.message || String(error) }));
          result.fieldDiagnostics.push({ playerNum, requested: playerName, ...fieldInfo });
          if (fieldInfo?.disabled) {
            console.log(`    ⚠️ Player ${playerNum}: field ${selectId} is disabled`);
            continue;
          }
          if (fieldInfo && fieldInfo.hasRequestedValue === false) {
            console.log(`    ⚠️ Player ${playerNum}: value ${playerName} not present in ${selectId}`);
            continue;
          }
          try {
            await selectElem.selectOption({ value: playerName }, { timeout: 2000 });
            await page.waitForTimeout(500);
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
      }
    } catch (error) {
      console.log(`    ❌ Error filling Player ${playerNum}: ${error.message}`);
    }
  }

  if (result.filled.length < playersToFill.length) {
    console.log(
      `  ⚠️ Not confirming: filled ${result.filled.length}/${playersToFill.length} requested player(s).`,
    );
    result.skippedReason = 'players-missing-before-confirm';
    result.confirmationText = 'players-missing-before-confirm';
    return result;
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
  dryRun = false,
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
    .locator(
      [
        `a[href*="/bookings/book/${hhmm}"]`,
        `a[href*="/bookings/book"][href$="/${hhmm}"]`,
        `a[href*="/bookings/book"][href$="${hhmm}"]`,
        `a[href*="/bookings/book"][href*="/${hhmm}?"]`,
        `a[href*="/bookings/book"][href*="/${hhmm}#"]`,
      ].join(', '),
    )
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

    const capacityForPlayers = Number.isFinite(Number(openSlots)) ? Number(openSlots) : 1;
    const confirmResult = await fillPlayersAndConfirm(page, players, capacityForPlayers, dryRun);
    const expectedPlayersCount = players.slice(0, Math.min(capacityForPlayers, 3)).length;
    const formValidated = (confirmResult.filled || []).length >= expectedPlayersCount;
    if (dryRun) {
      return {
        booked: false,
        dryRun: true,
        formValidated,
        playersFilled: confirmResult.filled,
        playersRequested: players.slice(0, Math.min(capacityForPlayers, 3)),
        confirmationText: confirmResult.confirmationText,
        skippedReason: confirmResult.skippedReason,
        fieldDiagnostics: confirmResult.fieldDiagnostics,
        error: formValidated ? null : 'dry-run-players-missing',
      };
    }
    const rowBooked =
      confirmResult.confirmationText !== null &&
      !confirmationBlocked(confirmResult.confirmationText);
    return {
      booked: rowBooked,
      playersFilled: confirmResult.filled,
      playersRequested: players.slice(0, Math.min(capacityForPlayers, 3)),
      confirmationText: confirmResult.confirmationText,
      skippedReason: confirmResult.skippedReason,
      fieldDiagnostics: confirmResult.fieldDiagnostics,
      error:
        !rowBooked
          ? confirmResult.confirmationText || 'booking-not-confirmed'
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
  const capacityForPlayers = Number.isFinite(Number(openSlots)) ? Number(openSlots) : 1;
  const confirmResult = await fillPlayersAndConfirm(page, players, capacityForPlayers, dryRun);
  const expectedPlayersCount = players.slice(0, Math.min(capacityForPlayers, 3)).length;
  const formValidated = (confirmResult.filled || []).length >= expectedPlayersCount;
  if (dryRun) {
    return {
      booked: false,
      dryRun: true,
      formValidated,
      playersFilled: confirmResult.filled,
      playersRequested: players.slice(0, Math.min(capacityForPlayers, 3)),
      confirmationText: confirmResult.confirmationText,
      skippedReason: confirmResult.skippedReason,
      fieldDiagnostics: confirmResult.fieldDiagnostics,
      clickDeltaMs,
      error: formValidated ? null : 'dry-run-players-missing',
    };
  }

  console.log('  ✅ Clicked booking link');
  console.log('  🔍 Verification started...');
  const verification = await verifyBookingConfirmation(page, time, 10000);
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
      !confirmationBlocked(confirmResult.confirmationText),
    playersFilled: confirmResult.filled,
    playersRequested: players.slice(0, Math.min(capacityForPlayers, 3)),
    confirmationText: confirmResult.confirmationText,
    skippedReason: confirmResult.skippedReason,
    fieldDiagnostics: confirmResult.fieldDiagnostics,
    verificationSignal: verification.verificationSignal,
    verificationUrl: verification.verificationUrl,
    bookingLinksCountAfterClick: verification.bookingLinksCountAfterClick,
    clickDeltaMs,
    error:
      !verification.confirmed
        ? 'clicked-but-no-confirmation'
        : confirmationBlocked(confirmResult.confirmationText)
          ? confirmResult.confirmationText
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

function computeReleaseFireUTCForTargetDate(
  targetDateKey,
  releaseTimeLocal = '19:20',
  tz = CONFIG.TZ_LONDON,
) {
  const normalizedTargetDate = normalizeDateKey(targetDateKey);
  if (!normalizedTargetDate) {
    throw new Error(`Invalid target date: ${targetDateKey}`);
  }

  const [hh, mm] = (releaseTimeLocal || '19:20').split(':');
  const hour = Number.parseInt(hh, 10);
  const minute = Number.parseInt(mm || '0', 10);
  if (Number.isNaN(hour) || Number.isNaN(minute)) {
    throw new Error(`Invalid release time: ${releaseTimeLocal}`);
  }

  const targetDate = DateTime.fromISO(normalizedTargetDate, { zone: tz }).startOf('day');
  return targetDate
    .minus({ days: 5 })
    .set({ hour, minute, second: 0, millisecond: 0 })
    .toUTC()
    .toJSDate();
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
      clickDeltaMs: fireLatencyMs,
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
    booked = Boolean(confirmationText) && !confirmationBlocked(confirmationText);
  }
  return {
    booked,
    confirmationText,
    playersFilled,
    fieldDiagnostics: confirmResult.fieldDiagnostics,
    clickDeltaMs: fireLatencyMs,
  };
}

async function pollPreferredBookingLinks(page, targetDateStr, preferredTimes, targetFireTime, options = {}) {
  if (!page?.context) {
    return { found: false, reason: 'missing-page-context', candidates: [] };
  }

  const timeoutMs = Number.isFinite(CONFIG.SNIPER_DIRECT_POLL_MS)
    ? Math.max(500, CONFIG.SNIPER_DIRECT_POLL_MS)
    : 6500;
  const intervalMs = Number.isFinite(CONFIG.SNIPER_DIRECT_POLL_INTERVAL_MS)
    ? Math.max(25, CONFIG.SNIPER_DIRECT_POLL_INTERVAL_MS)
    : 125;
  const requestTimeoutMs = Number.isFinite(CONFIG.SNIPER_DIRECT_POLL_REQUEST_TIMEOUT_MS)
    ? Math.max(500, CONFIG.SNIPER_DIRECT_POLL_REQUEST_TIMEOUT_MS)
    : 2500;
  const maxInFlight = Number.isFinite(CONFIG.SNIPER_DIRECT_POLL_MAX_IN_FLIGHT)
    ? Math.max(1, CONFIG.SNIPER_DIRECT_POLL_MAX_IN_FLIGHT)
    : 4;
  const deadline = Date.now() + timeoutMs;
  const preferredLabels = normalizePreferredTimeLabels(preferredTimes);
  const requiredPartySize = Number.isFinite(Number(options.partySize))
    ? Math.max(1, Number(options.partySize))
    : 1;
  let attempt = 0;
  let lastStatus = null;
  let lastError = null;
  let lastCandidateCount = 0;
  let lastSkippedInsufficientSlots = 0;
  let lastAvailableTimes = [];
  let lastRejectedCandidates = [];
  const inFlight = new Set();
  let nextLaunchAt = Date.now();
  let pollResolved = false;

  console.log(
    `[SNIPER] Direct HTML poll armed for ${targetDateStr}; preferred=${preferredLabels.join(', ')} partySize=${requiredPartySize} nearestWindow=${CONFIG.SNIPER_NEAREST_SLOT_WINDOW_MINUTES}m timeout=${timeoutMs}ms interval=${intervalMs}ms maxInFlight=${maxInFlight}`,
  );

  const launchAttempt = () => {
    attempt += 1;
    const currentAttempt = attempt;
    const requestStarted = Date.now();
    const promise = (async () => {
      try {
        const response = await page.context().request.get(teeSheetDataUrlForDate(targetDateStr), {
          headers: {
            'x-requested-with': 'XMLHttpRequest',
            accept: 'application/json, text/javascript, */*; q=0.01',
            'cache-control': 'no-cache, no-store, max-age=0',
            pragma: 'no-cache',
          },
          timeout: requestTimeoutMs,
        });
        const httpStatus = response.status();
        const payloadText = await response.text();
        const extracted = extractPreferredBookingLinks(payloadText, preferredTimes, targetDateStr, {
          partySize: requiredPartySize,
          nearestWindowMinutes: CONFIG.SNIPER_NEAREST_SLOT_WINDOW_MINUTES,
        });
        const detectAt = Date.now();
        if (extracted.found && !pollResolved) {
          pollResolved = true;
          console.log(
            `[SNIPER] Direct HTML poll found ${extracted.candidates.length} preferred link(s) on attempt ${currentAttempt}: ${extracted.availableTimes.join(', ')}`,
          );
        }
        return {
          found: extracted.found,
          source: 'direct-html-poll',
          candidates: extracted.candidates,
          availableTimes: extracted.availableTimes,
          preferredTimes: extracted.preferredTimes,
          attempt: currentAttempt,
          httpStatus,
          requestLatencyMs: detectAt - requestStarted,
          detectDeltaMs:
            Number.isFinite(targetFireTime) ? detectAt - targetFireTime : null,
          candidateCount: extracted.candidates.length,
          skippedInsufficientSlots: extracted.skippedInsufficientSlots ?? 0,
          rejectedCandidates: extracted.rejectedCandidates || [],
        };
      } catch (error) {
        const message = error?.message || String(error);
        console.warn(`[SNIPER] Direct HTML poll attempt ${currentAttempt} failed: ${message}`);
        return {
          found: false,
          source: 'direct-html-poll',
          candidates: [],
          availableTimes: [],
          attempt: currentAttempt,
          error: message,
          candidateCount: 0,
        };
      }
    })();
    inFlight.add(promise);
    promise.finally(() => inFlight.delete(promise));
  };

  while (Date.now() < deadline || inFlight.size > 0) {
    while (Date.now() < deadline && inFlight.size < maxInFlight && Date.now() >= nextLaunchAt) {
      launchAttempt();
      nextLaunchAt += intervalMs;
    }

    if (!inFlight.size) {
      await page.waitForTimeout(Math.min(25, Math.max(1, nextLaunchAt - Date.now())));
      continue;
    }

    const waitMs = Date.now() < deadline
      ? Math.min(25, Math.max(1, nextLaunchAt - Date.now()))
      : 25;
    const completed = await Promise.race([
      ...Array.from(inFlight),
      new Promise((resolve) => setTimeout(() => resolve(null), waitMs)),
    ]);
    if (!completed) continue;

    lastStatus = completed.httpStatus ?? lastStatus;
    lastError = completed.error ?? lastError;
    lastCandidateCount = completed.candidateCount ?? lastCandidateCount;
    lastSkippedInsufficientSlots =
      completed.skippedInsufficientSlots ?? lastSkippedInsufficientSlots;
    lastAvailableTimes = completed.availableTimes?.length ? completed.availableTimes : lastAvailableTimes;
    lastRejectedCandidates = completed.rejectedCandidates?.length
      ? completed.rejectedCandidates
      : lastRejectedCandidates;
    if (completed.found) {
      return completed;
    }
  }

  return {
    found: false,
    source: 'direct-html-poll',
    candidates: [],
    availableTimes: lastAvailableTimes,
    attempt,
    httpStatus: lastStatus,
    error: lastError,
    candidateCount: lastCandidateCount,
    skippedInsufficientSlots: lastSkippedInsufficientSlots,
    rejectedCandidates: lastRejectedCandidates,
  };
}

async function tryDirectBookingHref(
  page,
  candidate,
  players = [],
  openSlots = 3,
  targetFireTime = Date.now(),
  jobId = null,
  dryRun = false,
) {
  const time = candidate?.time || 'release';
  const href = candidate?.href;
  if (!href) {
    return { booked: false, error: 'missing-direct-booking-href' };
  }

  const clickDeltaMs = Date.now() - targetFireTime;
  console.log(`[SNIPER] DIRECT BOOKING NAV ${time} delta=${clickDeltaMs}ms`);
  if (clickDeltaMs > 250) {
    console.log('⚠️ DIRECT FIRE DELTA TOO HIGH');
    if (jobId) {
      logJobEvent(jobId, `⚠️ DIRECT FIRE DELTA TOO HIGH (${clickDeltaMs}ms)`);
    }
  }

  const navigationStarted = Date.now();
  await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 12000 });
  const navigationMs = Date.now() - navigationStarted;
  await page.waitForLoadState('networkidle', { timeout: 1500 }).catch(() => {});

  const formSelector = '#member_booking_form_confirm_booking, form[name="member_booking_form"]';
  const formVisible = await page
    .locator(formSelector)
    .first()
    .isVisible({ timeout: 2500 })
    .catch(() => false);

  if (!formVisible) {
    const bodyText = await page
      .locator('body')
      .innerText({ timeout: 1000 })
      .catch(() => '');
    const reason = /unavailable|already|not available|fully booked|no longer|error|invalid/i.test(bodyText)
      ? 'slot-not-bookable-after-direct-nav'
      : 'booking-form-not-found-after-direct-nav';
    const evidence = await savePageEvidence(page, `${jobId || 'direct'}-${time}-${reason}`);
    return {
      booked: false,
      error: reason,
      clickDeltaMs,
      navigationMs,
      verificationUrl: page.url(),
      bodySnippet: bodyText.replace(/\s+/g, ' ').trim().slice(0, 180),
      ...evidence,
    };
  }

  const capacityForPlayers = Number.isFinite(Number(openSlots)) ? Number(openSlots) : 1;
  const confirmResult = await fillPlayersAndConfirm(page, players, capacityForPlayers, dryRun);
  const expectedPlayersCount = players.slice(0, Math.min(capacityForPlayers, 3)).length;
  if (dryRun) {
    const formValidated = (confirmResult.filled || []).length >= expectedPlayersCount;
    const evidence = await savePageEvidence(page, `${jobId || 'direct'}-${time}-dry-run`);
    return {
      booked: false,
      dryRun: true,
      formValidated,
      error: formValidated ? null : 'dry-run-players-missing',
      confirmationText: confirmResult.confirmationText,
      playersFilled: confirmResult.filled,
      playersRequested: players.slice(0, Math.min(capacityForPlayers, 3)),
      fieldDiagnostics: confirmResult.fieldDiagnostics,
      clickDeltaMs,
      navigationMs,
      verificationSignal: 'dry-run',
      verificationUrl: page.url(),
      ...evidence,
    };
  }

  const verification = await verifyBookingConfirmation(page, time, 8000);
  if (expectedPlayersCount > 0 && (confirmResult.filled || []).length < expectedPlayersCount) {
    verification.confirmed = false;
    verification.verificationSignal = 'players-missing';
  }
  const evidence = await savePageEvidence(
    page,
    `${jobId || 'direct'}-${time}-${verification.confirmed ? 'confirmed' : verification.verificationSignal || 'failed'}`,
  );

  return {
    booked:
      verification.confirmed &&
      !confirmationBlocked(confirmResult.confirmationText),
    playersFilled: confirmResult.filled,
    playersRequested: players.slice(0, Math.min(capacityForPlayers, 3)),
    confirmationText: confirmResult.confirmationText,
    skippedReason: confirmResult.skippedReason,
    fieldDiagnostics: confirmResult.fieldDiagnostics,
    verificationSignal: verification.verificationSignal,
    verificationUrl: verification.verificationUrl,
    bookingLinksCountAfterClick: verification.bookingLinksCountAfterClick,
    clickDeltaMs,
    navigationMs,
    error:
      !verification.confirmed
        ? 'direct-clicked-but-no-confirmation'
        : confirmationBlocked(confirmResult.confirmationText)
          ? confirmResult.confirmationText
          : null,
    ...evidence,
  };
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

async function savePageScreenshot(page, label) {
  try {
    const outDir = path.join(agentDir, 'output');
    await fs.promises.mkdir(outDir, { recursive: true });
    const safe = String(label || 'booking').replace(/[^a-z0-9_-]/gi, '_');
    const fileName = `${safe}-page-${Date.now()}.png`;
    const filePath = path.join(outDir, fileName);
    await page.screenshot({ path: filePath, fullPage: true });
    return filePath;
  } catch {
    return null;
  }
}

async function savePageEvidence(page, label) {
  const [snapshotPath, screenshotPath] = await Promise.all([
    saveHtmlSnapshot(page, label),
    savePageScreenshot(page, label),
  ]);
  return { snapshotPath, screenshotPath };
}

function normalizeTimeToHHMM(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.padStart(4, '0').slice(-4);
}

function normalizeTimeLabel(value) {
  const hhmm = normalizeTimeToHHMM(value);
  if (!hhmm || hhmm.length !== 4) return null;
  const hours = Number.parseInt(hhmm.slice(0, 2), 10);
  const mins = Number.parseInt(hhmm.slice(2), 10);
  if (Number.isNaN(hours) || Number.isNaN(mins)) return null;
  if (hours < 0 || hours > 23 || mins < 0 || mins > 59) return null;
  return `${hhmm.slice(0, 2)}:${hhmm.slice(2)}`;
}

function normalizePreferredTimeLabels(preferredTimes) {
  const seen = new Set();
  const labels = [];
  for (const time of normalizeStringList(preferredTimes)) {
    const label = normalizeTimeLabel(time);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels;
}

function confirmationBlocked(confirmationText) {
  return [
    'confirm-button-not-found',
    'confirm-clicked-no-confirmation-text',
    'players-missing-before-confirm',
    'insufficient-open-slots',
    'dry-run-no-confirm',
  ].includes(confirmationText);
}

function preferredSlotRank(timeLabel, preferredLabels, nearestWindowMinutes = Number.POSITIVE_INFINITY) {
  const slotMinutes = timeToMinutes(timeLabel);
  if (slotMinutes === null || !preferredLabels.length) {
    return {
      preferredIndex: preferredLabels.length ? Number.MAX_SAFE_INTEGER : 0,
      deltaMinutes: 0,
      direction: 0,
      inWindow: true,
    };
  }

  let best = null;
  let nearest = null;
  preferredLabels.forEach((preferred, index) => {
    const preferredMinutes = timeToMinutes(preferred);
    if (preferredMinutes === null) return;
    const direction = slotMinutes - preferredMinutes;
    const deltaMinutes = Math.abs(direction);
    const candidate = {
      preferredIndex: index,
      deltaMinutes,
      direction,
      inWindow: deltaMinutes <= nearestWindowMinutes,
    };
    if (
      !nearest ||
      candidate.deltaMinutes < nearest.deltaMinutes ||
      (candidate.deltaMinutes === nearest.deltaMinutes && candidate.preferredIndex < nearest.preferredIndex)
    ) {
      nearest = candidate;
    }
    if (!candidate.inWindow) return;
    if (
      !best ||
      candidate.preferredIndex < best.preferredIndex ||
      (candidate.preferredIndex === best.preferredIndex && candidate.deltaMinutes < best.deltaMinutes) ||
      (
        candidate.preferredIndex === best.preferredIndex &&
        candidate.deltaMinutes === best.deltaMinutes &&
        candidate.direction <= 0 &&
        best.direction > 0
      )
    ) {
      best = candidate;
    }
  });

  return best || nearest || {
    preferredIndex: Number.MAX_SAFE_INTEGER,
    deltaMinutes: Number.MAX_SAFE_INTEGER,
    direction: 0,
    inWindow: false,
  };
}

function compactDateKey(value) {
  const normalized = normalizeDateKey(value);
  return normalized ? normalized.replace(/-/g, '') : null;
}

function decodeHtmlAttribute(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function extractPreferredBookingLinksFromHtml(html, preferredTimes, targetDateKey, options = {}) {
  const targetDateCompact = compactDateKey(targetDateKey);
  const preferredLabels = normalizePreferredTimeLabels(preferredTimes);
  const foundByTime = new Map();
  const rejectedCandidates = [];
  const hrefRegex = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let match;

  while ((match = hrefRegex.exec(String(html || ''))) !== null) {
    const rawHref = decodeHtmlAttribute(match[1] || match[2] || match[3] || '');
    if (!rawHref.includes('/bookings/book/')) continue;

    let parsed;
    try {
      parsed = new URL(rawHref, 'https://members.brsgolf.com');
    } catch {
      continue;
    }

    const segments = parsed.pathname.split('/').filter(Boolean);
    const timeSegment = segments[segments.length - 1];
    const dateSegment = segments[segments.length - 2];
    const timeLabel = normalizeTimeLabel(timeSegment);
    if (!timeLabel) continue;
    const preferredIndex = preferredLabels.indexOf(timeLabel);
    const rejection = [];
    if (targetDateCompact && dateSegment !== targetDateCompact) rejection.push('wrong-date');
    if (preferredIndex < 0) rejection.push('wrong-time');
    if (rejection.length) {
      rejectedCandidates.push({ time: timeLabel, href: parsed.href, reasons: rejection });
      continue;
    }
    if (foundByTime.has(timeLabel)) continue;

    foundByTime.set(timeLabel, {
      time: timeLabel,
      href: parsed.href,
      preferredIndex,
      preferenceDeltaMinutes: 0,
      preferenceDirection: 0,
      openSlots: null,
    });
  }

  const candidates = Array.from(foundByTime.values()).sort((a, b) => {
    if (a.preferredIndex !== b.preferredIndex) return a.preferredIndex - b.preferredIndex;
    if (a.preferenceDeltaMinutes !== b.preferenceDeltaMinutes) {
      return a.preferenceDeltaMinutes - b.preferenceDeltaMinutes;
    }
    return a.time.localeCompare(b.time);
  });

  return {
    found: candidates.length > 0,
    candidates,
    availableTimes: candidates.map((candidate) => candidate.time),
    preferredTimes: preferredLabels,
    skippedInsufficientSlots: 0,
    rejectedCandidates,
  };
}

function extractPreferredBookingLinksFromTeeData(payload, preferredTimes, targetDateKey, options = {}) {
  const preferredLabels = normalizePreferredTimeLabels(preferredTimes);
  const requiredPartySize = Number.isFinite(Number(options.partySize))
    ? Math.max(1, Number(options.partySize))
    : 1;
  const targetDateCompact = compactDateKey(targetDateKey);
  const candidates = [];
  const times = payload?.times && typeof payload.times === 'object' ? payload.times : {};
  let skippedInsufficientSlots = 0;
  const rejectedCandidates = [];

  for (const timeLabel of Object.keys(times)) {
    const normalizedTime = normalizeTimeLabel(timeLabel);
    if (!normalizedTime) continue;
    const entry = times[normalizedTime] || times[timeLabel];
    const teeTime = entry?.tee_time || entry;
    const bookable = teeTime?.bookable ?? entry?.bookable;
    if (bookable === false) continue;
    const urlValue = entry?.tee_time?.url || entry?.url || entry?.href;
    if (!urlValue) continue;
    const openSlots = getEntryOpenSlots(entry);
    if (openSlots !== null && openSlots < requiredPartySize) {
      skippedInsufficientSlots += 1;
      rejectedCandidates.push({ time: normalizedTime, reasons: ['insufficient-capacity'], openSlots });
      continue;
    }
    if (requiredPartySize > 1 && openSlots === null) {
      rejectedCandidates.push({ time: normalizedTime, reasons: ['capacity-unproven'], openSlots });
      continue;
    }
    const preferredIndex = preferredLabels.indexOf(normalizedTime);
    if (preferredIndex < 0) {
      rejectedCandidates.push({ time: normalizedTime, reasons: ['wrong-time'], openSlots });
      continue;
    }

    let parsed;
    try {
      parsed = new URL(decodeHtmlAttribute(urlValue), 'https://members.brsgolf.com');
    } catch {
      continue;
    }

    const segments = parsed.pathname.split('/').filter(Boolean);
    const timeSegment = normalizeTimeLabel(segments[segments.length - 1]);
    const dateSegment = segments[segments.length - 2];
    if (timeSegment && timeSegment !== normalizedTime) {
      rejectedCandidates.push({ time: normalizedTime, href: parsed.href, reasons: ['href-time-mismatch'], openSlots });
      continue;
    }
    if (targetDateCompact && dateSegment !== targetDateCompact) {
      rejectedCandidates.push({ time: normalizedTime, href: parsed.href, reasons: ['wrong-date'], openSlots });
      continue;
    }

    candidates.push({
      time: normalizedTime,
      href: parsed.href,
      preferredIndex,
      preferenceDeltaMinutes: 0,
      preferenceDirection: 0,
      openSlots,
      bookable: teeTime?.bookable ?? entry?.bookable ?? null,
      editable: teeTime?.editable ?? entry?.editable ?? null,
    });
  }

  candidates.sort((a, b) => {
    if (a.preferredIndex !== b.preferredIndex) return a.preferredIndex - b.preferredIndex;
    if (a.preferenceDeltaMinutes !== b.preferenceDeltaMinutes) {
      return a.preferenceDeltaMinutes - b.preferenceDeltaMinutes;
    }
    if ((b.openSlots ?? 0) !== (a.openSlots ?? 0)) return (b.openSlots ?? 0) - (a.openSlots ?? 0);
    return a.time.localeCompare(b.time);
  });

  return {
    found: candidates.length > 0,
    candidates,
    availableTimes: candidates.map((candidate) => candidate.time),
    preferredTimes: preferredLabels,
    skippedInsufficientSlots,
    rejectedCandidates,
  };
}

function extractPreferredBookingLinks(payloadText, preferredTimes, targetDateKey, options = {}) {
  try {
    const parsed = JSON.parse(String(payloadText || ''));
    const extracted = extractPreferredBookingLinksFromTeeData(parsed, preferredTimes, targetDateKey, options);
    if (parsed?.times && typeof parsed.times === 'object') return extracted;
    if (extracted.found) return extracted;
  } catch {
    // Fall back to HTML extraction below.
  }
  if (Number(options.partySize || 1) > 1) {
    return {
      found: false,
      candidates: [],
      availableTimes: [],
      preferredTimes: normalizePreferredTimeLabels(preferredTimes),
      skippedInsufficientSlots: 0,
      reason: 'capacity-unknown-html-response',
    };
  }
  return extractPreferredBookingLinksFromHtml(payloadText, preferredTimes, targetDateKey, options);
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
    targetDate,
    players = [],
    partySize,
    slotsData = [],
    warmPage = null,
    cachedSelectors = {},
    useReleaseObserver = false,
    dryRun = false,
    tee = 1,
    teeMode = 'single',
    teeTarget,
    fallbackTee = false,
    includeUnavailable = false,
    sourcePath = 'endpoint/dev',
  } = config;
  const normalizedTeeMode = teeMode === 'both' ? 'both' : 'single';
  const teeWasMissing = teeTarget === undefined && tee === undefined;
  const normalizedTeeTarget = parseTeeTarget(teeTarget ?? tee);
  let teeCtx = null;
  const teeLabelFromContext = () => {
    const selectedTee = teeCtx?.teeTarget ?? normalizedTeeTarget;
    return selectedTee === 10 ? '10TH TEE' : '1ST TEE';
  };
  if (!username || !password) {
    throw new Error('Missing BRS credentials for booking run');
  }
  let browser;
  let page;
  let isWarm = false;
  let runId;
  const startTime = Date.now();
  const targetDateStr = normalizeDateKey(targetDate || targetPlayDate) || normalizeDateKey(new Date());
  const teeDate = dateFromDateKey(targetDateStr) || new Date();
  const notes = [];
  const requestedPreferredTimes = normalizeStringList(preferredTimes);
  const normalizedPreferredTimes = normalizePreferredTimeLabels(requestedPreferredTimes);
  const slotPolicy = buildSlotPolicy({
    targetDate: targetDateStr,
    tee: normalizedTeeTarget,
    preferredTimes: normalizedPreferredTimes,
    partySize,
  });
  let bookedTime = null;
  let fallbackLevel = 0;
  let fallbackTeeUsed = false;
  let additionalPlayers = [];
  try {
    console.log(`[BOOKING] Source path: ${sourcePath}`);
    console.log(`[BOOKING] Target play date: ${targetDateStr}`);
    console.log(`[BOOKING] Requested tee: ${normalizedTeeTarget}${teeWasMissing ? ' (legacy default)' : ''}`);
    console.log(`[BOOKING] Preferred times: ${normalizedPreferredTimes.join(', ') || '(none)'}`);
    console.log(`[BOOKING] Party size: ${slotPolicy.partySize}`);
    if (!normalizedPreferredTimes.length) {
      throw new Error('missing-preferred-times');
    }
    if (!slotPolicy.targetDate) {
      throw new Error('missing-target-date');
    }
    if (!slotPolicy.tee) {
      throw new Error('missing-requested-tee');
    }
    if (teeWasMissing) {
      notes.push('Requested tee missing; applied legacy app default tee=1');
    }
    if (Number.isFinite(targetFireTime)) {
      console.log(`[BOOKING] Fire time UTC: ${new Date(targetFireTime).toISOString()}`);
    }
    console.log(`[BOOKING] Current UK time: ${DateTime.now().setZone(CONFIG.TZ_LONDON).toISO()}`);
    runId = await fsAddRun(jobId, ownerUid, new Date(), 'Booking attempt started');
    notes.push(
      `source=${sourcePath}; target=${targetDateStr}; tee=${normalizedTeeTarget}; preferred=${normalizedPreferredTimes.join(',')}; party=${slotPolicy.partySize}`,
    );
    if (warmPage) {
      page = warmPage;
      browser = page.context();
      isWarm = true;
      console.log('[WARM] Using preloaded session/page; skipping login + navigation');
    } else {
      browser = await chromium.launch({
        headless: true,
        args: ['--disable-blink-features=AutomationControlled'],
      });
      const context = await browser.newContext();
      page = await context.newPage();
      await loginToBRS(page, loginUrl || CONFIG.CLUB_LOGIN_URL, username, password);
      await navigateToTeeSheet(page, teeDate, false);
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(300);

      if (!pageMatchesDate(page, teeDate)) {
        throw new Error(`Unable to open tee sheet for target date ${targetDateStr}`);
      }
    }

    if (normalizedTeeMode === 'both') {
      const tee1 = await collectTeeResult(page, 1, targetDateStr, includeUnavailable);
      const tee10 = await collectTeeResult(page, 10, targetDateStr, includeUnavailable);
      const teeResult = {
        success: true,
        result: 'tee-data',
        teeMode: 'both',
        teeTarget: normalizedTeeTarget,
        teeData: { tee1, tee10 },
        selectedTee: normalizedTeeTarget,
        fallbackTeeUsed: false,
        notes: `Collected tee data for ${targetDateStr}`,
      };
      await fsFinishRun(runId, {
        result: 'tee-data',
        notes: teeResult.notes,
        latency_ms: Date.now() - startTime,
        chosen_time: null,
        fallback_level: 0,
        selected_tee: normalizedTeeTarget,
        fallback_tee_used: false,
      });
      if (browser && !isWarm) await browser.close();
      return teeResult;
    }

    teeCtx = await selectTeeForJob(page, config);
    const getTeeLabel = () => {
      if (!teeCtx) return teeLabelFromContext();
      return teeLabelFromContext();
    };
    const refreshBookingSlots = async () => {
      markDiagContext(page, targetDateStr, teeCtx?.teeTarget ?? normalizedTeeTarget);
      try {
        await waitForTeeRowsRendered(page);
      } catch (err) {
        console.warn('[TEE] Booking slots wait:', err?.message || err);
      }
      const { slots: scrapedSlots = [] } = await scrapeAvailableTimes(page, { includeUnavailable });
      return scrapedSlots.map((slot) => ({
        time: slot.time,
        state: slot.state,
        href: slot.href,
        openSlots: Number.isFinite(Number(slot.openSlots))
          ? Number(slot.openSlots)
          : null,
      }));
    };
    let bookingSlots = Array.isArray(slotsData) ? [...slotsData] : [];
    if (!bookingSlots.length && !useReleaseObserver) {
      bookingSlots = await refreshBookingSlots();
    }
    if (bookingSlots.length) {
      console.log(
        `[TEE] Available booking times detected: ${bookingSlots.map((slot) => slot.time).filter(Boolean).join(', ') || '(none)'}`,
      );
    }
    const desiredAdditionalCount = typeof partySize === 'number' ? Math.max(0, partySize - 1) : players.length;
    const desiredPartySize = desiredAdditionalCount + 1;
    additionalPlayers = players.slice(0, desiredAdditionalCount);
    const selectPreferredTimesFromSlots = (slots, { bookableOnly = false } = {}) => {
      const slotTimeSet = new Set(
        (Array.isArray(slots) ? slots : [])
          .filter((slot) => {
            if (!slot?.time) return false;
            if (desiredPartySize > 1 && !Number.isFinite(Number(slot.openSlots))) {
              return false;
            }
            if (Number.isFinite(Number(slot.openSlots)) && Number(slot.openSlots) < desiredPartySize) {
              return false;
            }
            return !bookableOnly || slot.state === 'bookable' || !!slot.href;
          })
          .map((slot) => slot.time),
      );
      return normalizedPreferredTimes.filter((time) => slotTimeSet.has(time));
    };

    const releaseArmLeadMs = useReleaseObserver && Number.isFinite(CONFIG.SNIPER_RELEASE_ARM_LEAD_MS)
      ? Math.max(0, CONFIG.SNIPER_RELEASE_ARM_LEAD_MS)
      : 0;
    const executionArmTime = targetFireTime - releaseArmLeadMs;
    if (releaseArmLeadMs > 0) {
      console.log(`[SNIPER] Release path will arm ${releaseArmLeadMs}ms before target fire time`);
    }
    await coarseWaitUntil(executionArmTime);
    console.log('\n[4/5] Executing precise timing...');
    await spinUntil(executionArmTime);
    const targetReachedAt = Date.now();
    let searchTimes = bookingSlots.length ? selectPreferredTimesFromSlots(bookingSlots) : [];
    if (!searchTimes.length && useReleaseObserver && normalizedPreferredTimes.length) {
      searchTimes = [...normalizedPreferredTimes];
      notes.push('Release watcher armed without pre-release candidate matches');
    }
    if (!searchTimes.length) {
      const message = 'no-candidate-times-on-sheet';
      console.warn(`[SNIPER] ${message}; requested times: ${normalizedPreferredTimes.join(', ')}`);
      notes.push('No candidate times on tee sheet');
      await fsFinishRun(runId, {
        result: message,
        notes: notes.join(' | ') || message,
        latency_ms: Date.now() - startTime,
        chosen_time: null,
        fallback_level: 0,
      });
      if (browser && !isWarm) await browser.close();
      return {
        success: false,
        result: message,
        bookedTime: null,
        fallbackLevel: 0,
        latencyMs: Date.now() - startTime,
        notes: 'No candidate times available on tee sheet',
        playersRequested: additionalPlayers,
        error: message,
        teeSelected: getTeeLabel(),
      };
    }
    const buildLocatorCache = (timesToTry) => {
      const cache = {};
      for (const time of timesToTry) {
        const hhmm = normalizeTimeToHHMM(time);
        if (!hhmm || hhmm.length !== 4) {
          console.log(`[WARN] Skipping invalid time format in preferredTimes: "${time}"`);
          continue;
        }
        const fallbackSel = [
          `a[href*="/bookings/book/${hhmm}"]`,
          `a[href*="/bookings/book"][href$="/${hhmm}"]`,
          `a[href*="/bookings/book"][href$="${hhmm}"]`,
          `a[href*="/bookings/book"][href*="/${hhmm}?"]`,
          `a[href*="/bookings/book"][href*="/${hhmm}#"]`,
        ].join(', ');
        const cachedSel = cachedSelectors?.[time] || fallbackSel;
        cache[time] = page.locator(cachedSel).first();
      }
      return cache;
    };
    let releaseResult = null;
    if (SAFE_MODE_ENABLED && !dryRun) {
      const safeNotes = 'SAFE_MODE prevented live booking click';
      notes.push(safeNotes);
      await fsFinishRun(runId, {
        result: 'blocked-safe-mode',
        notes: safeNotes,
        latency_ms: Date.now() - startTime,
        chosen_time: null,
        fallback_level: 0,
      });
      if (browser && !isWarm) await browser.close();
      return {
        success: false,
        result: 'blocked-safe-mode',
        bookedTime: null,
        fallbackLevel: 0,
        latencyMs: Date.now() - startTime,
        notes: safeNotes,
        playersRequested: additionalPlayers,
        blocked: true,
        reason: 'SAFE_MODE enabled',
        teeSelected: getTeeLabel(),
        candidateTimes: searchTimes,
        url: page.url(),
      };
    }
    let locatorCache = {};
    let releaseFallbackLocator = page.locator('a[href*="/bookings/book"]').first();

    const runPreferredTimesLoop = async (timesToTry) => {
      locatorCache = buildLocatorCache(timesToTry);
      releaseFallbackLocator = page.locator('a[href*="/bookings/book"]').first();
      for (const [index, time] of timesToTry.entries()) {
        try {
          console.log(`Trying time slot: ${time}`);
          const slotInfo = bookingSlots.find((s) => s.time === time);
          const openSlots = slotInfo && Number.isFinite(Number(slotInfo.openSlots)) ? Number(slotInfo.openSlots) : null;
          const evaluation = evaluateSlotCandidate(slotPolicy, {
            time,
            href: slotInfo?.href,
            date: targetDateStr,
            tee: teeCtx?.teeTarget ?? normalizedTeeTarget,
            openSlots,
          });
          console.log(
            `[CANDIDATE] considered source=preferred-loop jobId=${jobId || 'n/a'} date=${evaluation.selectedDate || 'n/a'} tee=${evaluation.selectedTee || 'n/a'} time=${evaluation.selectedTime || time} openSlots=${evaluation.openSlots ?? 'n/a'} accepted=${evaluation.accepted} reasons=${evaluation.reasons.join(',') || 'accepted'}`,
          );
          if (!evaluation.accepted) {
            const msg = `Rejected preferred candidate ${time}: ${evaluation.reasons.join(',')}`;
            console.log(msg);
            notes.push(msg);
            continue;
          }
          const bookingResult = await tryBookTime(
            page,
            time,
            additionalPlayers,
            openSlots,
            locatorCache[time] || releaseFallbackLocator,
            targetFireTime,
            jobId,
            dryRun,
          );
          if (bookingResult && bookingResult.booked) {
            bookedTime = time;
            const preferenceIndex = normalizedPreferredTimes.indexOf(time);
            fallbackLevel = preferenceIndex >= 0 ? preferenceIndex : index;
            notes.push(
              `Booked ${time}; Players filled: ${bookingResult.playersFilled?.join(', ') || 'none'}; Confirmation: ${bookingResult.confirmationText}`,
            );
            break;
          } else if (bookingResult?.dryRun && bookingResult?.formValidated) {
            bookedTime = time;
            const preferenceIndex = normalizedPreferredTimes.indexOf(time);
            fallbackLevel = preferenceIndex >= 0 ? preferenceIndex : index;
            notes.push(
              `Dry-run validated ${time}; Players filled: ${bookingResult.playersFilled?.join(', ') || 'none'}`,
            );
            break;
          } else if (bookingResult) {
            const msg = `Could not complete booking for ${time}: ${bookingResult.error || bookingResult.confirmationText}`;
            console.log(msg);
            finalError = finalError || bookingResult.error || bookingResult.confirmationText || 'booking-failed';
            notes.push(
              bookingResult.fieldDiagnostics
                ? `${msg}; fields=${JSON.stringify(bookingResult.fieldDiagnostics)}`
                : msg,
            );
            if (index < timesToTry.length - 1) {
              await reloadTeeSheetForRetry(`preferred-time-failed-${time}`).catch((error) => {
                console.warn('[SNIPER] Reload after preferred time failure failed:', error?.message || error);
              });
            }
          }
        } catch (error) {
          const msg = `Failed to book ${time}: ${error.message}`;
          console.error(msg);
          notes.push(msg);
        }
      }
      return !!bookedTime;
    };

    const reloadTeeSheetForRetry = async (reason) => {
      console.log(`[SNIPER] Reloading tee sheet for retry after ${reason}...`);
      const reloadUrl = teeSheetUrlForDate(targetDateStr);
      await page.goto(reloadUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(CONFIG.SNIPER_RELEASE_RETRY_RELOAD_DELAY_MS);
      teeCtx = await selectTeeForJob(page, {
        teeTarget: teeCtx?.teeTarget ?? normalizedTeeTarget,
        fallbackTee: teeCtx?.fallbackTee ?? fallbackTee,
      });
      bookingSlots = await refreshBookingSlots();
      return bookingSlots;
    };

    let bookingSuccess = false;
    let finalClickDeltaMs = null;
    let finalVerificationUrl = null;
    let finalVerificationSignal = null;
    let finalReleaseDetectDeltaMs = null;
    let finalSnapshotPath = null;
    let finalScreenshotPath = null;
    let finalBookingLinksCountAfterClick = null;
    let finalError = null;
    let finalAvailableTimes = null;
    let finalCandidateDiagnostics = null;
    let directCapacityRequired = false;
    let directCapacityFailed = false;
    let directCandidatesExhausted = false;
    if (useReleaseObserver) {
      directCapacityRequired =
        desiredPartySize > 1 &&
        CONFIG.SNIPER_DIRECT_POLL_ENABLED &&
        (teeCtx?.teeTarget ?? normalizedTeeTarget) === 1;
      if (
        CONFIG.SNIPER_DIRECT_POLL_ENABLED &&
        (teeCtx?.teeTarget ?? normalizedTeeTarget) === 1
      ) {
        const directPollResult = await pollPreferredBookingLinks(
          page,
          targetDateStr,
          searchTimes,
          targetFireTime,
          { partySize: desiredPartySize },
        );
        finalAvailableTimes = directPollResult.availableTimes || [];
        finalCandidateDiagnostics = {
          source: 'direct-html-poll',
          found: directPollResult.found === true,
          attempt: directPollResult.attempt ?? null,
          httpStatus: directPollResult.httpStatus ?? null,
          candidateCount: directPollResult.candidateCount ?? null,
          availableTimes: directPollResult.availableTimes || [],
          skippedInsufficientSlots: directPollResult.skippedInsufficientSlots ?? 0,
          rejectedCandidates: (directPollResult.rejectedCandidates || []).slice(0, 25),
        };

        if (directPollResult.found) {
          notes.push(
            `direct-html-poll found ${directPollResult.availableTimes.join(', ')} attempt=${directPollResult.attempt} detect_delta=${directPollResult.detectDeltaMs}ms skipped_insufficient=${directPollResult.skippedInsufficientSlots || 0}`,
          );
          for (const rejected of directPollResult.rejectedCandidates || []) {
            console.log(
              `[CANDIDATE] rejected source=direct time=${rejected.time || 'n/a'} reasons=${(rejected.reasons || []).join(',') || 'n/a'} openSlots=${rejected.openSlots ?? 'n/a'}`,
            );
          }

          for (const candidate of directPollResult.candidates) {
            const candidateWithContext = {
              ...candidate,
              date: targetDateStr,
              tee: teeCtx?.teeTarget ?? normalizedTeeTarget,
            };
            const evaluation = evaluateSlotCandidate(slotPolicy, candidateWithContext);
            console.log(
              `[CANDIDATE] considered source=direct jobId=${jobId || 'n/a'} date=${evaluation.selectedDate || 'n/a'} tee=${evaluation.selectedTee || 'n/a'} time=${evaluation.selectedTime || candidate.time || 'n/a'} openSlots=${evaluation.openSlots ?? 'n/a'} accepted=${evaluation.accepted} reasons=${evaluation.reasons.join(',') || 'accepted'}`,
            );
            if (!evaluation.accepted) {
              notes.push(
                `Rejected direct candidate ${candidate.time || 'n/a'}: ${evaluation.reasons.join(',')}`,
              );
              continue;
            }
            const slotInfo = bookingSlots.find((slot) => slot.time === candidate.time);
            const openSlots =
              Number.isFinite(Number(candidate.openSlots)) && Number(candidate.openSlots) > 0
                ? Number(candidate.openSlots)
                : slotInfo && slotInfo.openSlots > 0
                  ? slotInfo.openSlots
                  : null;
            if (desiredPartySize > 1 && !Number.isFinite(Number(openSlots))) {
              notes.push(`Rejected direct candidate ${candidate.time}: capacity-unproven`);
              continue;
            }
            const directResult = await tryDirectBookingHref(
              page,
              candidateWithContext,
              additionalPlayers,
              openSlots,
              targetFireTime,
              jobId,
              dryRun,
            );

            if (directResult?.dryRun && directResult?.formValidated) {
              bookedTime = candidate.time;
              fallbackLevel = candidate.preferredIndex ?? normalizedPreferredTimes.indexOf(candidate.time);
              notes.push(
                `Direct dry-run reached booking form for ${candidate.time}; navigation=${directResult.navigationMs}ms`,
              );
              await fsFinishRun(runId, {
                result: 'dry_run',
                notes: `Direct dry-run; ${notes.join(' | ')}`,
                latency_ms: Date.now() - startTime,
                chosen_time: bookedTime,
                fallback_level: fallbackLevel,
                click_delta_ms: directResult.clickDeltaMs ?? null,
                verification_url: directResult.verificationUrl ?? null,
                verification_signal: directResult.verificationSignal ?? 'dry-run',
                release_detect_delta_ms: directPollResult.detectDeltaMs ?? null,
                snapshot_path: directResult.snapshotPath ?? null,
                screenshot_path: directResult.screenshotPath ?? null,
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
                fieldDiagnostics: directResult.fieldDiagnostics ?? null,
                click_delta_ms: directResult.clickDeltaMs ?? null,
                verification_url: directResult.verificationUrl ?? null,
                verification_signal: directResult.verificationSignal ?? 'dry-run',
                release_detect_delta_ms: directPollResult.detectDeltaMs ?? null,
                snapshotPath: directResult.snapshotPath ?? null,
                screenshotPath: directResult.screenshotPath ?? null,
                teeSelected: getTeeLabel(),
                armedAfterTeeSelect: true,
              };
            }

            if (directResult?.booked) {
              bookedTime = candidate.time;
              fallbackLevel = candidate.preferredIndex ?? normalizedPreferredTimes.indexOf(candidate.time);
              if (fallbackLevel < 0) fallbackLevel = 0;
              bookingSuccess = true;
              console.log(`[SNIPER] Selected/clicked tee time: ${candidate.time}`);
              notes.push(
                `Direct release booking confirmed for ${candidate.time}; click_delta=${directResult.clickDeltaMs}ms navigation=${directResult.navigationMs}ms confirmation=${directResult.confirmationText || 'n/a'}`,
              );
              finalClickDeltaMs = directResult.clickDeltaMs ?? null;
              finalVerificationUrl = directResult.verificationUrl ?? null;
              finalVerificationSignal = directResult.verificationSignal ?? null;
              finalReleaseDetectDeltaMs = directPollResult.detectDeltaMs ?? null;
              finalSnapshotPath = directResult.snapshotPath ?? null;
              finalScreenshotPath = directResult.screenshotPath ?? null;
              break;
            }

            const directFailure = directResult?.error || directResult?.confirmationText || 'direct-booking-failed';
            console.log(`Could not complete direct booking for ${candidate.time}: ${directFailure}`);
            finalError = finalError || directFailure;
            finalClickDeltaMs = finalClickDeltaMs ?? directResult?.clickDeltaMs ?? null;
            finalVerificationUrl = finalVerificationUrl ?? directResult?.verificationUrl ?? null;
            finalVerificationSignal = finalVerificationSignal ?? directResult?.verificationSignal ?? null;
            finalReleaseDetectDeltaMs = finalReleaseDetectDeltaMs ?? directPollResult.detectDeltaMs ?? null;
            finalSnapshotPath = finalSnapshotPath ?? directResult?.snapshotPath ?? null;
            finalScreenshotPath = finalScreenshotPath ?? directResult?.screenshotPath ?? null;
            finalBookingLinksCountAfterClick =
              finalBookingLinksCountAfterClick ?? directResult?.bookingLinksCountAfterClick ?? null;
            notes.push(
              `Could not complete direct booking for ${candidate.time}: ${directFailure}; ` +
                `url=${directResult?.verificationUrl || page.url()}; ` +
                `signal=${directResult?.verificationSignal || 'n/a'}; ` +
                `snapshot=${directResult?.snapshotPath || 'n/a'}; ` +
                `screenshot=${directResult?.screenshotPath || 'n/a'}; ` +
                `fields=${directResult?.fieldDiagnostics ? JSON.stringify(directResult.fieldDiagnostics) : 'n/a'}; ` +
                `body=${directResult?.bodySnippet || 'n/a'}`,
            );

            if (!dryRun) {
              await reloadTeeSheetForRetry(`direct-booking-failed-${candidate.time}`).catch((error) => {
                console.warn('[SNIPER] Reload after direct candidate failure failed:', error?.message || error);
              });
            }
          }

          if (!bookingSuccess) {
            directCandidatesExhausted = true;
            await reloadTeeSheetForRetry('direct-html-poll-candidates-failed').catch((error) => {
              console.warn('[SNIPER] Reload after direct poll failure failed:', error?.message || error);
            });
          }
        } else {
          if (directCapacityRequired) {
            directCapacityFailed = true;
            finalError = finalError || 'direct-capacity-proof-failed';
          }
          for (const rejected of directPollResult.rejectedCandidates || []) {
            console.log(
              `[CANDIDATE] rejected source=direct time=${rejected.time || 'n/a'} reasons=${(rejected.reasons || []).join(',') || 'n/a'} openSlots=${rejected.openSlots ?? 'n/a'}`,
            );
          }
          notes.push(
            `direct-html-poll timeout attempts=${directPollResult.attempt} status=${directPollResult.httpStatus || 'n/a'} candidates=${directPollResult.candidateCount || 0} skipped_insufficient=${directPollResult.skippedInsufficientSlots || 0}`,
          );
        }
      } else if ((teeCtx?.teeTarget ?? normalizedTeeTarget) !== 1) {
        notes.push('direct-html-poll skipped for non-1st-tee target');
      }

      const allowDomReleaseWatcher =
        desiredPartySize <= 1;
      if (!allowDomReleaseWatcher) {
        notes.push(
          'release-dom-watcher skipped for multi-player job; capacity must be proven before click',
        );
      } else {
        const watchMs = Number.isFinite(CONFIG.SNIPER_RELEASE_WATCH_MS)
          ? Math.max(500, CONFIG.SNIPER_RELEASE_WATCH_MS)
          : 8000;
        const retries = Number.isFinite(CONFIG.SNIPER_RELEASE_RETRY_COUNT)
          ? Math.max(0, CONFIG.SNIPER_RELEASE_RETRY_COUNT)
          : 2;
        const maxAttempts = retries + 1;
        for (let attempt = 1; !bookingSuccess && attempt <= maxAttempts; attempt += 1) {
        console.log(
          `[SNIPER] Release watcher (MutationObserver) armed... attempt ${attempt}/${maxAttempts} timeout ${watchMs}ms`,
        );
        try {
          await page.waitForLoadState('domcontentloaded');
          releaseResult = await waitForBookingRelease(
            page,
            searchTimes,
            watchMs,
            true,
            {
              targetDate: targetDateStr,
              tee: teeCtx?.teeTarget ?? normalizedTeeTarget,
            },
          );
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
        if (attempt < maxAttempts && targetDateStr) {
          console.log('[SNIPER] Release watcher timeout — reloading tee sheet and retrying...');
          await reloadTeeSheetForRetry('release-watcher-timeout');
        }
      }
      if (!bookingSuccess && releaseResult && releaseResult.found) {
        const fireLatencyMs = releaseResult.fireLatencyMs;
        const releaseDetectDeltaMs = releaseResult.detectDeltaMs ?? null;
        const releaseClickedTime = releaseResult.slotTime || 'release';
        const releaseEvaluation = evaluateSlotCandidate(slotPolicy, {
          time: releaseResult.slotTime,
          href: releaseResult.href,
          date: targetDateStr,
          tee: teeCtx?.teeTarget ?? normalizedTeeTarget,
          openSlots: desiredPartySize,
        });
        console.log(
          `[CANDIDATE] considered source=dom-watcher jobId=${jobId || 'n/a'} date=${releaseEvaluation.selectedDate || 'n/a'} tee=${releaseEvaluation.selectedTee || 'n/a'} time=${releaseEvaluation.selectedTime || releaseClickedTime} openSlots=${releaseEvaluation.openSlots ?? 'n/a'} accepted=${releaseEvaluation.accepted} reasons=${releaseEvaluation.reasons.join(',') || 'accepted'}`,
        );
        if (!releaseEvaluation.accepted) {
          notes.push(
            `Rejected DOM watcher candidate ${releaseClickedTime}: ${releaseEvaluation.reasons.join(',')}`,
          );
          releaseResult = null;
        } else {
        console.log(`[FIRE] FIRE_LATENCY_MS=${fireLatencyMs}`);
        if (fireLatencyMs > 200) {
          console.warn(`[WARN] ⚠️ FIRE_LATENCY_MS >200ms: ${fireLatencyMs}ms`);
          if (jobId) logJobEvent(jobId, `⚠️ FIRE LATENCY HIGH (${fireLatencyMs}ms)`);
        }
        if (CONFIG.TEST_MODE) {
          console.log(`[TEST_MODE] Validation reached exact DOM watcher candidate`);
        }
        const clickResult = await tryDirectBookingHref(
          page,
          {
            time: releaseResult.slotTime,
            href: releaseResult.href,
            date: targetDateStr,
            tee: teeCtx?.teeTarget ?? normalizedTeeTarget,
          },
          additionalPlayers,
          desiredPartySize,
          targetReachedAt,
          jobId,
          dryRun,
        );
        if (dryRun) {
          const diagnostics = {
            fire_latency_ms: fireLatencyMs,
            verification_url: page.url(),
            verification_signal: 'dry-run',
          };
          bookedTime = releaseClickedTime;
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
            ...(dryRun ? { teeSelected: getTeeLabel(), armedAfterTeeSelect: true } : {}),
          };
        }
        console.log('[SNIPER] Verification started...');
        const verification = await verifyBookingConfirmation(
          page,
          releaseResult.slotTime || 'release',
          12000,
        );
        if (confirmationBlocked(clickResult?.confirmationText)) {
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
          release_detect_delta_ms: releaseDetectDeltaMs,
          verification_url: verification.verificationUrl,
          verification_signal: verification.verificationSignal,
          booking_links_count_after_click: verification.bookingLinksCountAfterClick,
          release_candidate_count: releaseResult.candidateCount ?? null,
        };

        if (verification.confirmed) {
          const evidence = await savePageEvidence(page, runId || jobId || 'release-confirmed');
          bookedTime = releaseClickedTime;
          fallbackLevel = 0;
          finalClickDeltaMs = clickDeltaMsConfirmed;
          finalVerificationUrl = verification.verificationUrl;
          finalVerificationSignal = verification.verificationSignal;
          finalReleaseDetectDeltaMs = releaseDetectDeltaMs;
          finalSnapshotPath = evidence.snapshotPath;
          finalScreenshotPath = evidence.screenshotPath;
          notes.push(
            `Release-night booking confirmed; Detected at delta ${releaseDetectDeltaMs}ms confirmation=${clickResult?.confirmationText || 'n/a'}`,
          );
          await fsFinishRun(runId, {
            result: 'success_confirmed',
            notes: `Release-booked; ${notes.join(' | ')}`,
            latency_ms: Date.now() - startTime,
            chosen_time: bookedTime,
            fallback_level: fallbackLevel,
            snapshot_path: evidence.snapshotPath,
            screenshot_path: evidence.screenshotPath,
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
            snapshotPath: evidence.snapshotPath,
            screenshotPath: evidence.screenshotPath,
            teeSelected: getTeeLabel(),
            ...diagnostics,
          };
        }

        console.log('[SNIPER] Verification failed: no confirmation within 12s');
        const evidence = await savePageEvidence(page, runId || jobId || 'release');
        notes.push(
          `Release click for ${releaseClickedTime} failed verification (${verification.verificationSignal || 'no-confirmation'}); snapshot=${evidence.snapshotPath || 'n/a'} screenshot=${evidence.screenshotPath || 'n/a'}`,
        );

        const releaseClickedHHMM = normalizeTimeToHHMM(releaseResult.slotTime);
        let retryTimes = releaseClickedHHMM
          ? searchTimes.filter((time) => normalizeTimeToHHMM(time) !== releaseClickedHHMM)
          : [...searchTimes];

        if (retryTimes.length) {
          console.log(`[SNIPER] Trying remaining preferred times after failed release click: ${retryTimes.join(', ')}`);
          try {
            await reloadTeeSheetForRetry('failed-release-click');
            const liveRemainingTimes = selectPreferredTimesFromSlots(bookingSlots, { bookableOnly: true })
              .filter((time) => !releaseClickedHHMM || normalizeTimeToHHMM(time) !== releaseClickedHHMM);
            if (liveRemainingTimes.length) {
              retryTimes = liveRemainingTimes;
            }
            bookingSuccess = await runPreferredTimesLoop(retryTimes);
            if (bookingSuccess) {
              notes.push('Recovered by booking a remaining preferred time after failed release click');
            }
          } catch (retryError) {
            const retryMessage = retryError?.message || String(retryError);
            console.warn(`[SNIPER] Remaining preferred-time retry failed: ${retryMessage}`);
            notes.push(`Remaining preferred-time retry failed: ${retryMessage}`);
          }
        } else {
          notes.push('No remaining preferred times to retry after failed release click');
        }

        if (!bookingSuccess) {
          await fsFinishRun(runId, {
            result: 'click_only',
            notes: `Clicked booking link but no confirmation; ${notes.join(' | ')}`,
            latency_ms: Date.now() - startTime,
            chosen_time: bookedTime,
            fallback_level: fallbackLevel,
            snapshot_path: evidence.snapshotPath,
            screenshot_path: evidence.screenshotPath,
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
            snapshotPath: evidence.snapshotPath,
            screenshotPath: evidence.screenshotPath,
            teeSelected: getTeeLabel(),
            ...diagnostics,
          };
        }
        }
      } else if (!bookingSuccess) {
        console.log('[SNIPER] Release watcher timeout — refreshing exact preferred candidates');
        try {
          bookingSlots = await refreshBookingSlots();
          const liveBookableTimes = selectPreferredTimesFromSlots(bookingSlots, { bookableOnly: true });
          if (liveBookableTimes.length) {
            searchTimes = liveBookableTimes;
          }
        } catch (refreshError) {
          console.warn('[SNIPER] Could not refresh slots after release watcher timeout:', refreshError?.message || refreshError);
        }
        }
      }
    }
    const skipUnsafeMultiPlayerDomFallback =
      directCapacityRequired && (directCapacityFailed || directCandidatesExhausted);
    if (!bookingSuccess && skipUnsafeMultiPlayerDomFallback) {
      const reason = directCapacityFailed
        ? 'no direct BRS capacity proof for full party'
        : 'direct BRS candidates exhausted for full party';
      console.warn(`[SNIPER] Skipping DOM fallback for multi-player job: ${reason}`);
      notes.push(`Skipped DOM fallback for multi-player job: ${reason}`);
      finalError = finalError || (directCapacityFailed ? 'direct-capacity-proof-failed' : 'direct-candidates-exhausted');
    }
    if (!bookingSuccess && !skipUnsafeMultiPlayerDomFallback) {
      bookingSuccess = await runPreferredTimesLoop(searchTimes);
    }
    if (!bookingSuccess && teeCtx?.fallbackTee && !fallbackTeeUsed) {
      const fallbackResult = await maybeFallbackToAltTee(page, teeCtx, 'preferred_time_not_found');
      if (fallbackResult.didFallback) {
        fallbackTeeUsed = true;
        teeCtx = { ...teeCtx, teeTarget: fallbackResult.teeTarget };
        notes.push(`[TEE] Fallback to tee ${fallbackResult.teeTarget} after primary tee had no available slots`);
        bookingSlots = await refreshBookingSlots();
        const fallbackTimeSet = new Set(bookingSlots.map((slot) => slot.time));
        searchTimes = normalizedPreferredTimes.filter((time) => fallbackTimeSet.has(time));
        if (!searchTimes.length) {
          const message = 'no-candidate-times-on-sheet';
          console.warn(`[SNIPER] ${message} after tee fallback`);
          notes.push('No candidate times after tee fallback');
          await fsFinishRun(runId, {
            result: message,
            notes: notes.join(' | '),
            latency_ms: Date.now() - startTime,
            chosen_time: null,
            fallback_level: fallbackLevel,
          });
          if (browser && !isWarm) await browser.close();
          return {
            success: false,
            result: message,
            bookedTime: null,
            fallbackLevel,
            latencyMs: Date.now() - startTime,
            notes: 'No candidate times available on fallback tee',
            playersRequested: additionalPlayers,
            error: message,
            teeSelected: getTeeLabel(),
          };
        }
        bookingSuccess = await runPreferredTimesLoop(searchTimes);
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
      click_delta_ms: finalClickDeltaMs,
      verification_url: finalVerificationUrl,
      verification_signal: finalVerificationSignal,
      booking_links_count_after_click: finalBookingLinksCountAfterClick,
      release_detect_delta_ms: finalReleaseDetectDeltaMs,
      snapshot_path: finalSnapshotPath,
      screenshot_path: finalScreenshotPath,
      available_times: finalAvailableTimes,
      candidate_diagnostics: finalCandidateDiagnostics,
      source_path: sourcePath,
      requested_tee: normalizedTeeTarget,
      tee_selected: getTeeLabel(),
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

    console.log(
      `[BOOKING] Final result: success=${success} result=${resultType} booked=${bookedTime || 'n/a'} notes=${finalNotes}`,
    );
    return {
      success,
      result: resultType,
      bookedTime,
      fallbackLevel,
      latencyMs: Date.now() - startTime,
      notes: finalNotes,
      playersRequested: additionalPlayers,
      availableTimes: finalAvailableTimes,
      candidateDiagnostics: finalCandidateDiagnostics,
      sourcePath,
      requestedTee: normalizedTeeTarget,
      teeSelected: getTeeLabel(),
      click_delta_ms: finalClickDeltaMs,
      verification_url: finalVerificationUrl,
      verification_signal: finalVerificationSignal,
      booking_links_count_after_click: finalBookingLinksCountAfterClick,
      release_detect_delta_ms: finalReleaseDetectDeltaMs,
      snapshotPath: finalSnapshotPath,
      screenshotPath: finalScreenshotPath,
      error: success ? null : finalError,
      ...(dryRun ? { armedAfterTeeSelect: true } : {}),
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
      source_path: sourcePath,
      requested_tee: normalizedTeeTarget,
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
      teeSelected: teeLabelFromContext(),
      sourcePath,
      requestedTee: normalizedTeeTarget,
    };
  }
}

// --- Release-night helper endpoint ---
app.post('/api/release-snipe', async (req, res) => {
  try {
    if (blockAccidentalLiveEndpoint(req, res, '/api/release-snipe')) return;
    const {
      username,
      password,
      targetDate,
      fireTimeUtc,
      preferredTimes,
      players = [],
      partySize,
      teeTarget,
      fallbackTee,
      dryRun = false,
    } = req.body;
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
    const resolvedTeeTarget = parseTeeTarget(teeTarget ?? req.body?.tee);
    const resolvedFallbackTee = parseBooleanFlag(fallbackTee, false);
    const result = await runBooking({
      jobId: 'release-snipe-' + Date.now(),
      ownerUid: 'release-night',
      loginUrl: CONFIG.CLUB_LOGIN_URL,
      username,
      password,
      preferredTimes: times,
      targetFireTime: fireTime,
      targetPlayDate: targetDate,
      players: Array.isArray(players) ? players : [],
      partySize,
      slotsData: [],
      warmPage,
      useReleaseObserver: true,
      teeTarget: resolvedTeeTarget,
      fallbackTee: resolvedFallbackTee,
      dryRun: parseBooleanFlag(dryRun, false),
      sourcePath: 'endpoint:/api/release-snipe',
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
  console.log(`[BOOT] SAFE_MODE=${SAFE_MODE_ENABLED}`);
});

export {
  runBooking,
  computeNextFireUTC,
  computeReleaseFireUTCForTargetDate,
  normalizeDateKey,
  fsGetOneActiveJob,
};
