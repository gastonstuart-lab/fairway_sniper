import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import admin from 'firebase-admin';
import os from 'os';
import crypto from 'crypto';
import { DateTime } from 'luxon';
import * as warmSession from './warm_session.js';

const PUBLIC_PORT = Number.parseInt(process.env.PORT || '3000', 10);
const INTERNAL_PORT = Number.parseInt(
  process.env.INTERNAL_AGENT_PORT || String(PUBLIC_PORT + 1),
  10,
);

// The legacy module still contains the battle-tested BRS booking engine and
// non-booking helper endpoints. Import it on a private localhost port with its
// old Firestore runner disabled. This process owns production scheduling.
process.env.AGENT_RUN_MAIN = 'false';
process.env.PORT = String(INTERNAL_PORT);

const legacy = await import('./index.js');
const {
  runBooking,
  computeReleaseFireUTCForTargetDate,
  normalizeDateKey,
} = legacy;

const RUNNER_VERSION = 'production-v2';
const RUNNER_INSTANCE_ID = `${os.hostname()}:${process.pid}:${RUNNER_VERSION}`;
const FIRE_RECOVERY_GRACE_MS = Number.parseInt(
  process.env.SNIPER_FIRE_RECOVERY_GRACE_MS || '15000',
  10,
);
const PREP_LEAD_MS = Number.parseInt(
  process.env.SNIPER_PREP_LEAD_MS || '240000',
  10,
);
const FIRE_WARM_RECOVERY_MS = Number.parseInt(
  process.env.SNIPER_FIRE_WARM_RECOVERY_MS || '8000',
  10,
);
const MAX_TIMER_DELAY_MS = 2_147_000_000;
const JOBS_COLLECTION = 'jobs';
const ELIGIBLE_STATUSES = new Set([
  'active',
  'queued',
  'accepted',
  'pending',
  'running',
]);
const TERMINAL_STATES = new Set([
  'finished',
  'booked',
  'error',
  'failed',
  'cancelled',
  'canceled',
]);

const db = admin.apps.length ? admin.firestore() : null;
const firebaseProjectId = admin.apps.length
  ? admin.app().options.projectId || process.env.FIREBASE_PROJECT_ID || null
  : process.env.FIREBASE_PROJECT_ID || null;

const timersByJob = new Map();
let runnerStarted = false;
let listenerConnected = false;
let lastRunnerEvent = null;
let lastRunnerError = null;

function safeError(error) {
  return error?.message || String(error);
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateKeyFromJob(job) {
  return normalizeDateKey(job?.target_date || job?.targetDate || job?.target_play_date || job?.targetPlayDate);
}

function isProofJob(job) {
  return job?.proof_test === true && job?.dry_run === true;
}

function isEligibleJob(job) {
  if (!job) return false;
  const mode = String(job.mode || job.bookingMode || '').toLowerCase();
  if (mode !== 'sniper') return false;
  const status = String(job.status || '').toLowerCase();
  const state = String(job.state || '').toLowerCase();
  if (TERMINAL_STATES.has(status) || TERMINAL_STATES.has(state)) return false;
  if (['paused', 'draft'].includes(state)) return false;
  if (job.booking_finished_at || job.finished_at) return false;
  return ELIGIBLE_STATUSES.has(status) || Boolean(state);
}

function resolveFireTime(job) {
  // A short-horizon override is deliberately allowed only for an explicit
  // proof job that is also dry-run. Live jobs cannot bypass the BRS release
  // calculation with a Firestore field.
  if (isProofJob(job)) {
    const proofOverride =
      toDate(job.proof_fire_time_utc) ||
      toDate(job.proofFireTimeUtc) ||
      toDate(job.fire_time_utc) ||
      toDate(job.fireTimeUtc);
    if (proofOverride) return proofOverride;
  }

  const targetDate = dateKeyFromJob(job);
  if (targetDate) {
    return computeReleaseFireUTCForTargetDate(
      targetDate,
      job.release_time_local || job.releaseTimeLocal || '19:20',
      job.tz || job.timezone || 'Europe/London',
    );
  }

  return (
    toDate(job.next_fire_time_utc) ||
    toDate(job.nextFireTimeUtc) ||
    toDate(job.release_window_start) ||
    toDate(job.releaseWindowStart)
  );
}

function resolveTargetPlayDate(job) {
  const key = dateKeyFromJob(job);
  if (key) return new Date(`${key}T12:00:00.000Z`);
  return toDate(job.target_play_date) || toDate(job.targetPlayDate);
}

function makeRunId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString('hex');
}

function cleanMetadata(metadata = {}) {
  const blocked = /password|passcode|secret|private|credential|token|brs_email|brsemail|username/i;
  const result = {};
  for (const [key, value] of Object.entries(metadata || {})) {
    if (blocked.test(key)) continue;
    if (value instanceof Date) result[key] = value.toISOString();
    else if (typeof value?.toDate === 'function') result[key] = value.toDate().toISOString();
    else if (value === undefined) result[key] = null;
    else result[key] = value;
  }
  return result;
}

async function updateJob(jobId, patch) {
  if (!db || !jobId) return;
  await db.collection(JOBS_COLLECTION).doc(jobId).update({
    ...patch,
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function addEvent(jobId, type, metadata = {}) {
  const clean = cleanMetadata(metadata);
  lastRunnerEvent = {
    type,
    jobId,
    at: new Date().toISOString(),
    ...clean,
  };
  if (/FAILED|ERROR|MISSED|NOT_READY/.test(type)) {
    lastRunnerError = lastRunnerEvent;
  }

  if (!db || !jobId) return;
  const event = {
    type,
    at: admin.firestore.FieldValue.serverTimestamp(),
    runner_instance_id: RUNNER_INSTANCE_ID,
    runner_version: RUNNER_VERSION,
    firebase_project_id: firebaseProjectId,
    ...clean,
  };
  await db
    .collection(JOBS_COLLECTION)
    .doc(jobId)
    .collection('events')
    .add(event);
  await updateJob(jobId, {
    last_agent_event: type,
    last_agent_event_at: admin.firestore.FieldValue.serverTimestamp(),
    last_agent_runner: RUNNER_INSTANCE_ID,
    last_agent_version: RUNNER_VERSION,
    ...(clean.error || clean.reason
      ? { last_agent_error: clean.error || clean.reason }
      : {}),
  });
}

function scheduleLongTimeout(callback, delayMs) {
  let cancelled = false;
  let currentHandle = null;

  const arm = (remaining) => {
    if (cancelled) return;
    const slice = Math.min(Math.max(0, remaining), MAX_TIMER_DELAY_MS);
    currentHandle = setTimeout(() => {
      if (cancelled) return;
      const next = remaining - slice;
      if (next > 0) arm(next);
      else callback();
    }, slice);
    currentHandle.unref?.();
  };

  arm(delayMs);
  return {
    cancel() {
      cancelled = true;
      if (currentHandle) clearTimeout(currentHandle);
    },
  };
}

function clearEntryTimers(entry) {
  entry?.prepHandle?.cancel?.();
  entry?.fireHandle?.cancel?.();
  if (entry) {
    entry.prepHandle = null;
    entry.fireHandle = null;
    entry.hasPrepTimer = false;
    entry.hasFireTimer = false;
  }
}

function cancelJobTimers(jobId, reason = 'job-no-longer-active') {
  const entry = timersByJob.get(jobId);
  if (!entry) return;
  clearEntryTimers(entry);
  timersByJob.delete(jobId);
  console.log(`[V2] cancelled timers for ${jobId}: ${reason}`);
}

async function claimForScheduling(jobId) {
  if (!db) return null;
  const ref = db.collection(JOBS_COLLECTION).doc(jobId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const data = snap.data() || {};
    if (!isEligibleJob(data)) return null;
    if (data.booking_started_at || data.booking_finished_at) return null;

    const runId = data.run_id || data.runId || makeRunId();
    tx.update(ref, {
      claimed_by: RUNNER_INSTANCE_ID,
      claimed_at: admin.firestore.FieldValue.serverTimestamp(),
      run_id: runId,
      runner_version: RUNNER_VERSION,
      state: 'production_confirmed',
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { id: snap.id, ...data, run_id: runId };
  });
}

async function acquireFireLease(jobId) {
  if (!db) return null;
  const ref = db.collection(JOBS_COLLECTION).doc(jobId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const data = snap.data() || {};
    if (!isEligibleJob(data)) return null;
    if (data.booking_started_at || data.fire_claimed_at) return null;

    tx.update(ref, {
      status: 'running',
      state: 'firing',
      fire_claimed_at: admin.firestore.FieldValue.serverTimestamp(),
      fire_claimed_by: RUNNER_INSTANCE_ID,
      booking_started_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { id: snap.id, ...data };
  });
}

async function markMissed(jobId, fireTime, reason = 'MISSED_FIRE_TIME') {
  await addEvent(jobId, 'MISSED_FIRE_TIME', {
    reason,
    fireTimeUtc: fireTime?.toISOString?.() || null,
  });
  await updateJob(jobId, {
    status: 'error',
    state: 'error',
    error_message: reason,
    finished_at: admin.firestore.FieldValue.serverTimestamp(),
  });
  cancelJobTimers(jobId, reason);
}

function withTimeout(promise, timeoutMs, message) {
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    timeout.unref?.();
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout));
}

async function runPrep(jobId) {
  const entry = timersByJob.get(jobId);
  if (!entry || entry.prepStarted) return;
  entry.prepStarted = true;
  entry.hasPrepTimer = false;
  entry.prepFiredAt = new Date().toISOString();

  await addEvent(jobId, 'PREP_TIMER_FIRED', {
    prepTimeUtc: entry.prepTime.toISOString(),
    fireTimeUtc: entry.fireTime.toISOString(),
  });

  try {
    const snap = await db.collection(JOBS_COLLECTION).doc(jobId).get();
    if (!snap.exists) throw new Error('job-disappeared-before-prep');
    const job = { id: snap.id, ...snap.data() };
    if (!isEligibleJob(job)) {
      cancelJobTimers(jobId, 'job-not-eligible-at-prep');
      return;
    }

    const username = job.brs_email || job.brsEmail || job.username;
    const password = job.brs_password || job.brsPassword || job.password;
    const targetPlayDate = resolveTargetPlayDate(job);
    if (!username || !password || !targetPlayDate) {
      throw new Error('missing-credentials-or-target-date');
    }

    await updateJob(jobId, { state: 'warming', warm_state: 'warming' });
    await addEvent(jobId, 'WARMUP_STARTED', {
      targetDate: dateKeyFromJob(job),
    });

    entry.warmPromise = warmSession.getWarmPage(targetPlayDate, username, password);
    entry.warmPage = await entry.warmPromise;
    entry.warmPromise = null;

    const warmStatus = warmSession.getWarmStatus();
    if (!entry.warmPage || warmStatus.authenticated !== true || warmStatus.teeSheetLoaded !== true) {
      throw new Error('warm-session-not-authenticated-and-ready');
    }

    entry.readyAt = new Date().toISOString();
    await updateJob(jobId, {
      state: 'ready',
      warm_state: 'warmed',
      warmed_at: admin.firestore.FieldValue.serverTimestamp(),
    });
    await addEvent(jobId, 'BRS_AUTHENTICATED', {
      targetDate: dateKeyFromJob(job),
    });
    await addEvent(jobId, 'READY', {
      fireTimeUtc: entry.fireTime.toISOString(),
    });
  } catch (error) {
    entry.warmPromise = null;
    entry.warmError = safeError(error);
    await updateJob(jobId, {
      state: 'production_confirmed',
      warm_state: 'warm_error',
      warm_error: entry.warmError,
    }).catch(() => {});
    await addEvent(jobId, 'WARMUP_FAILED', { error: entry.warmError }).catch(() => {});
  }
}

async function discoverProofPreferredTimes(page, requestedTimes = []) {
  if (!page || page.isClosed?.()) return requestedTimes;
  try {
    const available = await page.evaluate(() => {
      const seen = new Set();
      const result = [];
      for (const link of Array.from(document.querySelectorAll('a[href*="/bookings/book"]'))) {
        const href = link.href || link.getAttribute('href') || '';
        const matches = String(href).match(/\/(\d{3,4})(?:[/?#]|$)/g) || [];
        let time = null;
        for (const segment of matches.reverse()) {
          const digits = segment.replace(/\D/g, '').padStart(4, '0').slice(-4);
          const hh = Number.parseInt(digits.slice(0, 2), 10);
          const mm = Number.parseInt(digits.slice(2), 10);
          if (hh <= 23 && mm <= 59) {
            time = `${digits.slice(0, 2)}:${digits.slice(2)}`;
            break;
          }
        }
        if (time && !seen.has(time)) {
          seen.add(time);
          result.push(time);
        }
      }
      return result;
    });
    const normalizedRequested = (requestedTimes || []).map((v) => String(v));
    const requestedAvailable = normalizedRequested.filter((time) => available.includes(time));
    if (requestedAvailable.length) return requestedAvailable;
    if (available.length) return [available[0]];
  } catch (error) {
    console.warn(`[V2] proof slot discovery failed: ${safeError(error)}`);
  }
  return requestedTimes;
}

function bookingConfigFromJob(job, entry, warmPage, preferredTimesOverride = null) {
  const preferredTimes = preferredTimesOverride || job.preferred_times || job.preferredTimes || [];
  const proof = isProofJob(job);
  return {
    jobId: job.id,
    ownerUid: job.ownerUid || job.owner_uid || 'unknown',
    loginUrl: process.env.CLUB_LOGIN_URL || 'https://members.brsgolf.com/galgorm/login',
    username: job.brs_email || job.brsEmail || job.username,
    password: job.brs_password || job.brsPassword || job.password,
    preferredTimes,
    targetFireTime: entry.fireTime.getTime(),
    targetPlayDate: resolveTargetPlayDate(job),
    targetDate: dateKeyFromJob(job),
    players: proof ? [] : Array.isArray(job.players) ? job.players : [],
    partySize: proof ? 1 : typeof job.party_size === 'number' ? job.party_size : job.partySize,
    slotsData: [],
    warmPage,
    useReleaseObserver: true,
    pushToken: proof ? null : job.push_token || job.pushToken,
    dryRun: proof || job.dry_run === true || job.dryRun === true,
    tee: job.tee_target || job.teeTarget || job.tee || 1,
    teeMode: job.tee_mode || job.teeMode || 'single',
    teeTarget: job.tee_target || job.teeTarget || job.tee || 1,
    fallbackTee: job.fallback_tee === true || job.fallbackTee === true,
    sourcePath: proof ? 'firestore-production-proof-v2' : 'firestore-runner-v2',
  };
}

async function runFire(jobId) {
  const entry = timersByJob.get(jobId);
  if (!entry || entry.fireStarted) return;
  entry.fireStarted = true;
  entry.hasFireTimer = false;
  entry.fireFiredAt = new Date().toISOString();

  const leaseJob = await acquireFireLease(jobId);
  if (!leaseJob) {
    await addEvent(jobId, 'FIRE_SUPPRESSED_DUPLICATE', {
      reason: 'booking/fire already claimed by another runner',
    }).catch(() => {});
    cancelJobTimers(jobId, 'duplicate-fire-suppressed');
    return;
  }

  await addEvent(jobId, 'FIRE_TIMER_FIRED', {
    fireTimeUtc: entry.fireTime.toISOString(),
    fireDeltaMs: Date.now() - entry.fireTime.getTime(),
  });

  try {
    const snap = await db.collection(JOBS_COLLECTION).doc(jobId).get();
    if (!snap.exists) throw new Error('job-disappeared-at-fire');
    const job = { id: snap.id, ...snap.data() };
    const targetPlayDate = resolveTargetPlayDate(job);
    const username = job.brs_email || job.brsEmail || job.username;
    const password = job.brs_password || job.brsPassword || job.password;
    if (!username || !password || !targetPlayDate) {
      throw new Error('missing-credentials-or-target-date');
    }

    let warmPage = entry.warmPage;
    let warmStatus = warmSession.getWarmStatus();
    const ready =
      warmPage &&
      !warmPage.isClosed?.() &&
      warmStatus.authenticated === true &&
      warmStatus.teeSheetLoaded === true;

    if (!ready) {
      await addEvent(jobId, 'BRS_NOT_READY_AT_FIRE_TIME', {
        warmState: job.warm_state || null,
        lastWarmError: entry.warmError || warmStatus.lastError || null,
      });
      try {
        warmPage = await withTimeout(
          warmSession.getWarmPage(targetPlayDate, username, password),
          FIRE_WARM_RECOVERY_MS,
          `warm recovery exceeded ${FIRE_WARM_RECOVERY_MS}ms`,
        );
        warmStatus = warmSession.getWarmStatus();
        if (warmStatus.authenticated === true && warmStatus.teeSheetLoaded === true) {
          entry.warmPage = warmPage;
          await addEvent(jobId, 'BRS_AUTHENTICATED', {
            targetDate: dateKeyFromJob(job),
            recoveredAtFire: true,
          });
        } else {
          warmPage = null;
        }
      } catch (error) {
        entry.warmError = safeError(error);
        warmPage = null;
        await addEvent(jobId, 'FIRE_WARM_RECOVERY_FAILED', {
          error: entry.warmError,
        });
      }
    }

    let proofPreferredTimes = null;
    if (isProofJob(job)) {
      proofPreferredTimes = await discoverProofPreferredTimes(
        warmPage,
        job.preferred_times || job.preferredTimes || [],
      );
      await addEvent(jobId, 'PROOF_SLOT_SELECTED', {
        preferredTimes: proofPreferredTimes,
        targetDate: dateKeyFromJob(job),
      });
    }

    await updateJob(jobId, { state: 'booking' });
    await addEvent(jobId, 'BOOKING_STARTED', {
      proof: isProofJob(job),
      targetDate: dateKeyFromJob(job),
      preferredTimes: proofPreferredTimes || job.preferred_times || [],
      teeTarget: job.tee_target || job.teeTarget || job.tee || 1,
    });

    const result = await runBooking(
      bookingConfigFromJob(job, entry, warmPage, proofPreferredTimes),
    );

    if (isProofJob(job)) {
      const proofReached =
        result?.success === true &&
        (result?.result === 'dry_run' || result?.armedAfterTeeSelect === true);
      if (proofReached) {
        await addEvent(jobId, 'DRY_RUN_PREBOOK_REACHED', {
          selectedTime: result?.bookedTime || null,
          teeSelected: result?.teeSelected || null,
          verificationSignal: result?.verification_signal || result?.verificationSignal || 'dry-run',
        });
        await addEvent(jobId, 'PROOF_SUCCESS', {
          selectedTime: result?.bookedTime || null,
          latencyMs: result?.latencyMs || null,
        });
        await updateJob(jobId, {
          status: 'finished',
          state: 'proof_success',
          result: 'PROOF_SUCCESS',
          booked_time: null,
          proof_selected_time: result?.bookedTime || null,
          proof_finished_at: admin.firestore.FieldValue.serverTimestamp(),
          booking_finished_at: admin.firestore.FieldValue.serverTimestamp(),
          error_message: null,
        });
      } else {
        const reason = result?.error || result?.notes || result?.result || 'proof-did-not-reach-prebook-boundary';
        await addEvent(jobId, 'PROOF_FAILED', { error: reason });
        await updateJob(jobId, {
          status: 'error',
          state: 'error',
          result: 'PROOF_FAILED',
          error_message: reason,
          proof_finished_at: admin.firestore.FieldValue.serverTimestamp(),
          booking_finished_at: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    } else if (result?.success === true) {
      await addEvent(jobId, 'BOOKING_SUCCESS', {
        bookedTime: result?.bookedTime || null,
        result: result?.result || 'success',
        latencyMs: result?.latencyMs || null,
      });
      await updateJob(jobId, {
        status: 'finished',
        state: 'finished',
        result: result?.result || 'success',
        booked_time: result?.bookedTime || null,
        booking_finished_at: admin.firestore.FieldValue.serverTimestamp(),
        finished_at: admin.firestore.FieldValue.serverTimestamp(),
        error_message: null,
      });
    } else {
      const reason = result?.error || result?.notes || result?.result || 'booking-failed';
      await addEvent(jobId, 'BOOKING_FAILED', {
        error: reason,
        result: result?.result || 'failed',
      });
      await updateJob(jobId, {
        status: 'error',
        state: 'error',
        result: result?.result || 'failed',
        error_message: reason,
        booking_finished_at: admin.firestore.FieldValue.serverTimestamp(),
        finished_at: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  } catch (error) {
    const reason = safeError(error);
    await addEvent(jobId, 'PROOF_FAILED', { error: reason }).catch(() => {});
    await addEvent(jobId, 'BOOKING_FAILED', { error: reason }).catch(() => {});
    await updateJob(jobId, {
      status: 'error',
      state: 'error',
      error_message: reason,
      booking_finished_at: admin.firestore.FieldValue.serverTimestamp(),
      finished_at: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(() => {});
  } finally {
    cancelJobTimers(jobId, 'fire-complete');
  }
}

async function scheduleJob(job) {
  if (!db || !job?.id) return;
  if (timersByJob.has(job.id)) return;
  if (!isEligibleJob(job)) return;

  const claimed = await claimForScheduling(job.id);
  if (!claimed) return;
  const merged = { ...job, ...claimed };
  const fireTime = resolveFireTime(merged);
  const targetPlayDate = resolveTargetPlayDate(merged);
  if (!fireTime || !targetPlayDate) {
    await markMissed(job.id, fireTime, 'missing-fire-time-or-target-date');
    return;
  }

  const fireMs = fireTime.getTime();
  const prepTime = new Date(fireMs - Math.max(0, PREP_LEAD_MS));
  const now = Date.now();
  if (fireMs < now - FIRE_RECOVERY_GRACE_MS) {
    await markMissed(job.id, fireTime);
    return;
  }

  const entry = {
    jobId: job.id,
    runId: merged.run_id,
    fireTime,
    prepTime,
    createdAt: new Date().toISOString(),
    prepStarted: false,
    fireStarted: false,
    hasPrepTimer: true,
    hasFireTimer: true,
    prepHandle: null,
    fireHandle: null,
    warmPage: null,
    warmPromise: null,
    warmError: null,
  };
  timersByJob.set(job.id, entry);

  const prepDelay = Math.max(0, prepTime.getTime() - now);
  const fireDelay = Math.max(0, fireMs - now);
  entry.prepHandle = scheduleLongTimeout(() => {
    runPrep(job.id).catch((error) => {
      lastRunnerError = {
        type: 'PREP_CALLBACK_ERROR',
        jobId: job.id,
        at: new Date().toISOString(),
        error: safeError(error),
      };
    });
  }, prepDelay);
  entry.fireHandle = scheduleLongTimeout(() => {
    runFire(job.id).catch((error) => {
      lastRunnerError = {
        type: 'FIRE_CALLBACK_ERROR',
        jobId: job.id,
        at: new Date().toISOString(),
        error: safeError(error),
      };
    });
  }, fireDelay);

  await addEvent(job.id, 'JOB_ACCEPTED', {
    runId: merged.run_id,
    proof: isProofJob(merged),
  });
  await addEvent(job.id, 'PREP_TIMER_CREATED', {
    prepTimeUtc: prepTime.toISOString(),
    delayMs: prepDelay,
  });
  await addEvent(job.id, 'FIRE_TIMER_CREATED', {
    fireTimeUtc: fireTime.toISOString(),
    delayMs: fireDelay,
  });
  await updateJob(job.id, {
    state: 'production_confirmed',
    production_confirmed_at: admin.firestore.FieldValue.serverTimestamp(),
    computed_prep_time_utc: admin.firestore.Timestamp.fromDate(prepTime),
    computed_fire_time_utc: admin.firestore.Timestamp.fromDate(fireTime),
    prep_timer_registered: true,
    fire_timer_registered: true,
    runner_instance_id: RUNNER_INSTANCE_ID,
    runner_version: RUNNER_VERSION,
  });

  if (prepTime.getTime() <= now) {
    queueMicrotask(() => {
      runPrep(job.id).catch((error) => {
        lastRunnerError = {
          type: 'PREP_IMMEDIATE_ERROR',
          jobId: job.id,
          at: new Date().toISOString(),
          error: safeError(error),
        };
      });
    });
  }
}

function timerSnapshot(entry) {
  if (!entry) return null;
  return {
    jobId: entry.jobId,
    runId: entry.runId,
    prepTimeUtc: entry.prepTime.toISOString(),
    fireTimeUtc: entry.fireTime.toISOString(),
    createdAt: entry.createdAt,
    hasPrepTimer: entry.hasPrepTimer,
    hasFireTimer: entry.hasFireTimer,
    prepStarted: entry.prepStarted,
    fireStarted: entry.fireStarted,
    prepFiredAt: entry.prepFiredAt || null,
    fireFiredAt: entry.fireFiredAt || null,
    readyAt: entry.readyAt || null,
    warmError: entry.warmError || null,
  };
}

function activeTimerCounts() {
  let prep = 0;
  let fire = 0;
  for (const entry of timersByJob.values()) {
    if (entry.hasPrepTimer) prep += 1;
    if (entry.hasFireTimer) fire += 1;
  }
  return { prep, fire, total: prep + fire };
}

async function safeJobStatus(jobId) {
  const snap = await db.collection(JOBS_COLLECTION).doc(jobId).get();
  if (!snap.exists) return null;
  const job = { id: snap.id, ...snap.data() };
  const entry = timersByJob.get(jobId) || null;
  const fireTime = resolveFireTime(job);
  const prepTime = fireTime ? new Date(fireTime.getTime() - Math.max(0, PREP_LEAD_MS)) : null;
  const now = Date.now();
  const prepAlreadyApplicable = prepTime ? now >= prepTime.getTime() : false;
  const prepComplete =
    entry?.prepStarted === true ||
    ['warming', 'warmed'].includes(String(job.warm_state || '').toLowerCase()) ||
    ['warming', 'ready', 'booking', 'firing'].includes(String(job.state || '').toLowerCase());
  const hasPrepTimer = entry?.hasPrepTimer === true;
  const hasFireTimer = entry?.hasFireTimer === true;
  const productionConfirmed =
    listenerConnected &&
    hasFireTimer &&
    (hasPrepTimer || prepAlreadyApplicable || prepComplete);
  const tz = job.tz || job.timezone || 'Europe/London';
  const warmStatus = warmSession.getWarmStatus();

  return {
    success: true,
    visibleToAgent: true,
    agentWillAccept: isEligibleJob(job) || Boolean(entry),
    productionConfirmed,
    firebaseProjectId,
    runnerInstanceId: RUNNER_INSTANCE_ID,
    runnerVersion: RUNNER_VERSION,
    agentRunMain: true,
    sniperRunnerStarted: runnerStarted,
    firestoreConnected: Boolean(db),
    listenerConnected,
    serverCurrentTimeUtc: new Date(now).toISOString(),
    serverCurrentTimeLocal: DateTime.fromMillis(now).setZone(tz).toISO(),
    id: jobId,
    mode: job.mode || null,
    status: job.status || null,
    state: job.state || null,
    proofTest: isProofJob(job),
    targetDate: dateKeyFromJob(job),
    preferredTimes: job.preferred_times || [],
    tee: job.tee_target || job.teeTarget || job.tee || 1,
    partySize: job.party_size || job.partySize || null,
    computedPrepTimeUtc: prepTime?.toISOString() || null,
    computedPrepTimeLocal: prepTime ? DateTime.fromJSDate(prepTime).setZone(tz).toISO() : null,
    computedFireTimeUtc: fireTime?.toISOString() || null,
    computedFireTimeLocal: fireTime ? DateTime.fromJSDate(fireTime).setZone(tz).toISO() : null,
    secondsUntilPrep: prepTime ? Math.round((prepTime.getTime() - now) / 1000) : null,
    secondsUntilFire: fireTime ? Math.round((fireTime.getTime() - now) / 1000) : null,
    hasPrepTimer,
    hasFireTimer,
    prepComplete,
    prepTimerDetails: entry ? timerSnapshot(entry) : null,
    fireTimerDetails: entry ? timerSnapshot(entry) : null,
    warmState: job.warm_state || null,
    brsAuthenticated: warmStatus.authenticated === true,
    teeSheetLoaded: warmStatus.teeSheetLoaded === true,
    claimedBy: job.claimed_by || null,
    runId: job.run_id || null,
    lastAgentEvent: job.last_agent_event || null,
    lastAgentError: job.last_agent_error || null,
    errorMessage: job.error_message || null,
    result: job.result || null,
  };
}

async function loadAndScheduleActiveJobs() {
  const snapshot = await db
    .collection(JOBS_COLLECTION)
    .where('mode', '==', 'sniper')
    .where('status', 'in', Array.from(ELIGIBLE_STATUSES))
    .get();
  for (const doc of snapshot.docs) {
    const job = { id: doc.id, ...doc.data() };
    if (isEligibleJob(job)) {
      await addEvent(job.id, 'JOB_SEEN', {
        status: job.status || null,
        state: job.state || null,
        startupRecovery: true,
      }).catch(() => {});
      await scheduleJob(job).catch((error) => {
        lastRunnerError = {
          type: 'STARTUP_SCHEDULE_ERROR',
          jobId: job.id,
          at: new Date().toISOString(),
          error: safeError(error),
        };
      });
    }
  }
}

function startRunner() {
  if (!db) {
    lastRunnerError = {
      type: 'FIRESTORE_NOT_CONFIGURED',
      at: new Date().toISOString(),
      error: 'Firebase Admin is not configured',
    };
    return;
  }

  runnerStarted = true;
  warmSession.startKeepAlive({ intervalMs: 30000 });

  loadAndScheduleActiveJobs().catch((error) => {
    lastRunnerError = {
      type: 'STARTUP_LOAD_ERROR',
      at: new Date().toISOString(),
      error: safeError(error),
    };
  });

  const query = db
    .collection(JOBS_COLLECTION)
    .where('mode', '==', 'sniper')
    .where('status', 'in', Array.from(ELIGIBLE_STATUSES));

  query.onSnapshot(
    (snapshot) => {
      listenerConnected = true;
      for (const change of snapshot.docChanges()) {
        const jobId = change.doc.id;
        if (change.type === 'removed') {
          cancelJobTimers(jobId, 'firestore-job-removed-from-active-query');
          continue;
        }
        const job = { id: jobId, ...change.doc.data() };
        if (!isEligibleJob(job)) {
          cancelJobTimers(jobId, 'firestore-job-no-longer-eligible');
          continue;
        }
        addEvent(jobId, 'JOB_SEEN', {
          status: job.status || null,
          state: job.state || null,
        })
          .catch(() => {})
          .finally(() => {
            scheduleJob(job).catch((error) => {
              lastRunnerError = {
                type: 'SCHEDULE_ERROR',
                jobId,
                at: new Date().toISOString(),
                error: safeError(error),
              };
            });
          });
      }
    },
    (error) => {
      listenerConnected = false;
      lastRunnerError = {
        type: 'FIRESTORE_LISTENER_ERROR',
        at: new Date().toISOString(),
        error: safeError(error),
      };
    },
  );
}

const app = express();
app.use(cors());
app.use(express.raw({ type: () => true, limit: '10mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    status: db && runnerStarted ? 'ok' : 'degraded',
    service: 'fairway-sniper-production-v2',
    runnerVersion: RUNNER_VERSION,
    firebaseProjectId,
    firestoreConnected: Boolean(db),
    listenerConnected,
  });
});

app.get('/api/version', (_req, res) => {
  res.json({
    success: true,
    runnerVersion: RUNNER_VERSION,
    gitHash:
      process.env.RAILWAY_GIT_COMMIT_SHA ||
      process.env.RAILWAY_GIT_SHA ||
      process.env.GIT_SHA ||
      'unknown',
    branch:
      process.env.RAILWAY_GIT_BRANCH ||
      process.env.RAILWAY_GIT_REF_NAME ||
      process.env.GIT_BRANCH ||
      'main',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/runtime-status', (_req, res) => {
  const timerCounts = activeTimerCounts();
  res.json({
    success: true,
    runnerVersion: RUNNER_VERSION,
    runnerInstanceId: RUNNER_INSTANCE_ID,
    firebaseProjectId,
    firebaseAdminReady: Boolean(db),
    firestoreConnected: Boolean(db),
    listenerConnected,
    agentRunMain: true,
    sniperRunnerStarted: runnerStarted,
    activeSniperTimers: timerCounts.total,
    activePrepTimers: timerCounts.prep,
    activeFireTimers: timerCounts.fire,
    activeSniperJobs: timersByJob.size,
    timers: Array.from(timersByJob.values()).map(timerSnapshot),
    brsBrowserStatus: warmSession.getWarmStatus(),
    lastRunnerEvent,
    lastRunnerError,
    gitHash:
      process.env.RAILWAY_GIT_COMMIT_SHA ||
      process.env.RAILWAY_GIT_SHA ||
      process.env.GIT_SHA ||
      'unknown',
    branch:
      process.env.RAILWAY_GIT_BRANCH ||
      process.env.RAILWAY_GIT_REF_NAME ||
      process.env.GIT_BRANCH ||
      'main',
    time: new Date().toISOString(),
  });
});

app.get('/api/firestore/jobs/:jobId/status', async (req, res) => {
  if (!db) {
    return res.status(503).json({
      success: false,
      visibleToAgent: false,
      firebaseProjectId,
      error: 'firebase-admin-not-configured',
    });
  }
  try {
    const status = await safeJobStatus(req.params.jobId);
    if (!status) {
      return res.status(404).json({
        success: false,
        visibleToAgent: false,
        firebaseProjectId,
        error: 'firestore-job-not-found',
      });
    }
    return res.json(status);
  } catch (error) {
    return res.status(500).json({
      success: false,
      visibleToAgent: false,
      firebaseProjectId,
      error: safeError(error),
    });
  }
});

app.get('/api/firestore/jobs/:jobId/events', async (req, res) => {
  if (!db) {
    return res.status(503).json({ success: false, error: 'firebase-admin-not-configured' });
  }
  try {
    const snapshot = await db
      .collection(JOBS_COLLECTION)
      .doc(req.params.jobId)
      .collection('events')
      .orderBy('at', 'asc')
      .limit(200)
      .get();
    return res.json({
      success: true,
      jobId: req.params.jobId,
      firebaseProjectId,
      events: snapshot.docs.map((doc) => ({
        id: doc.id,
        ...cleanMetadata(doc.data()),
      })),
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: safeError(error) });
  }
});

// Public live-booking helper endpoints are intentionally blocked. Production
// booking is accepted only through Firestore jobs, where the runner can prove
// ownership, timers, state and event history. Safe proof also uses Firestore.
app.all(['/api/release-snipe', '/api/sniper-test', '/api/snipe'], (_req, res) => {
  res.status(403).json({
    success: false,
    error: 'Public booking endpoints are disabled. Use Firestore production jobs or Safe Production Proof.',
  });
});

app.use(async (req, res) => {
  try {
    const targetUrl = `http://127.0.0.1:${INTERNAL_PORT}${req.originalUrl}`;
    const headers = { ...req.headers };
    delete headers.host;
    delete headers['content-length'];

    const method = req.method.toUpperCase();
    const body = ['GET', 'HEAD'].includes(method)
      ? undefined
      : Buffer.isBuffer(req.body)
        ? req.body
        : req.body
          ? Buffer.from(JSON.stringify(req.body))
          : undefined;

    const response = await fetch(targetUrl, {
      method,
      headers,
      body,
      redirect: 'manual',
    });

    response.headers.forEach((value, key) => {
      if (!['transfer-encoding', 'content-encoding', 'content-length'].includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });
    const payload = Buffer.from(await response.arrayBuffer());
    return res.status(response.status).send(payload);
  } catch (error) {
    return res.status(502).json({
      success: false,
      error: `internal-agent-proxy-failed: ${safeError(error)}`,
    });
  }
});

startRunner();

app.listen(PUBLIC_PORT, '0.0.0.0', () => {
  console.log('='.repeat(70));
  console.log(`[V2] Fairway Sniper production runner listening on :${PUBLIC_PORT}`);
  console.log(`[V2] legacy booking engine private on 127.0.0.1:${INTERNAL_PORT}`);
  console.log(`[V2] runner=${RUNNER_INSTANCE_ID}`);
  console.log(`[V2] firebaseProjectId=${firebaseProjectId || 'unconfigured'}`);
  console.log(`[V2] PREP lead=${PREP_LEAD_MS}ms FIRE recovery grace=${FIRE_RECOVERY_GRACE_MS}ms`);
  console.log('='.repeat(70));
});
