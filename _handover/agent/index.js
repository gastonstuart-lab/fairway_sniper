import 'dotenv/config';
import fs from 'fs';
import path from 'path';

// TEMP: Log signal receipt for SIGINT/SIGTERM investigation
process.on('SIGINT', () => console.log('[TEMP LOG] SIGINT received', new Date().toISOString()));
process.on('SIGTERM', () => console.log('[TEMP LOG] SIGTERM received', new Date().toISOString()));

// === Directory Guard: Ensure running from agent directory ===
const cwd = process.cwd();
const expected = path.basename(cwd).toLowerCase() === 'agent';
const hasPkg = fs.existsSync(path.join(cwd, 'package.json'));
if (!expected || !hasPkg) {
  console.error('\n[ERROR] Wrong directory. Run: cd <repo>\\agent && node index.js');
  process.exit(1);
}


import express from 'express';
import cors from 'cors';
import crypto from 'crypto';

import * as warmSession from './warm_session.js';

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
  console.error('[FATAL] uncaughtException', err);
});

process.on('unhandledRejection', (err) => {
  console.error('[FATAL] unhandledRejection', err);
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
    console.log('705 Firebase initialized');
  } catch (error) {
    console.warn('6a0e0f Firebase init failed:', error.message);
    console.log('   Running in local-only mode');
  }
} else {
  console.log('6a0e0f Firebase not configured - running in local-only mode');
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
    return docRef;
  } catch (error) {
    console.error('Error adding run:', error);
    return null;
  }
}
