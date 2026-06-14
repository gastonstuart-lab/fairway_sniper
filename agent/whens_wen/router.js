import path from 'path';
import {
  COLLECTIONS,
  LEGACY_GUESSES,
  LEGACY_WEEKS,
  ZONE,
  aggregateLeaderboard,
  currentWeekId,
  guessDocumentId,
  normalizeName,
  normalizePlayerKey,
  normalizeTime,
  publicError,
  scoreGuesses,
  serializeGuess,
} from './core.js';

const stateBuckets = new Map();
const writeBuckets = new Map();
const adminBuckets = new Map();

export function installWhensWen(app, { getDb, admin, DateTime, agentDir }) {
  if (!app || typeof app.get !== 'function') {
    throw new Error("When's Wen requires an Express app");
  }
  if (app.locals?.whensWenInstalled) return;
  app.locals.whensWenInstalled = true;

  const htmlPath = path.join(agentDir, 'whens_wen', 'public', 'index.html');
  const adminEmail = String(process.env.WHENS_WEN_ADMIN_EMAIL || 'gastonstuart@googlemail.com').trim().toLowerCase();
  const dbOrNull = () => {
    try {
      return typeof getDb === 'function' ? getDb() : null;
    } catch {
      return null;
    }
  };

  const stateLimit = rateLimit(stateBuckets, 120, 60000);
  const writeLimit = rateLimit(writeBuckets, 20, 600000);
  const adminLimit = rateLimit(adminBuckets, 10, 600000);

  const requireAdmin = async (req, res, next) => {
    try {
      const header = String(req.headers.authorization || '');
      const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
      if (!token) return res.status(401).json({ success: false, error: 'Admin sign-in required.' });
      const decoded = await admin.auth().verifyIdToken(token);
      const tokenEmail = String(decoded.email || '').trim().toLowerCase();
      let allowed = tokenEmail === adminEmail;
      if (!allowed && decoded.uid) {
        const userSnap = await dbOrNull()?.collection('users').doc(decoded.uid).get();
        allowed = userSnap?.exists && userSnap.data()?.isAdmin === true;
      }
      if (!allowed) return res.status(403).json({ success: false, error: 'This account is not an admin.' });
      req.whensWenAdmin = decoded;
      return next();
    } catch (error) {
      console.warn('[WHENS_WEN] Admin authentication failed:', error?.message || error);
      return res.status(401).json({ success: false, error: 'Admin sign-in expired or invalid.' });
    }
  };

  app.get(['/whens-wen', '/whens-wen/'], (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(htmlPath);
  });

  app.get('/api/whens-wen/health', (_req, res) => {
    res.json({ success: true, service: 'whens-wen', databaseReady: Boolean(dbOrNull()) });
  });

  app.get('/api/whens-wen/state', stateLimit, async (_req, res) => {
    const db = dbOrNull();
    if (!db) return databaseUnavailable(res);
    try {
      await ensureLegacySeed(db, admin, DateTime);
      return res.json({ success: true, ...(await buildState(db, admin, DateTime)) });
    } catch (error) {
      console.error('[WHENS_WEN] state failed:', error);
      return res.status(500).json({ success: false, error: 'Could not load the game.' });
    }
  });

  app.post('/api/whens-wen/guess', writeLimit, async (req, res) => {
    const db = dbOrNull();
    if (!db) return databaseUnavailable(res);
    try {
      await ensureLegacySeed(db, admin, DateTime);
      const name = normalizeName(req.body?.name);
      const guessTime = normalizeTime(req.body?.time);
      if (!name) return res.status(400).json({ success: false, error: 'Enter a name between 2 and 40 characters.' });
      if (!guessTime) return res.status(400).json({ success: false, error: 'Choose a valid time.' });

      const weekId = currentWeekId(DateTime);
      const playerKey = normalizePlayerKey(name);
      const guessRef = db.collection(COLLECTIONS.guesses).doc(guessDocumentId(weekId, playerKey));
      const weekRef = db.collection(COLLECTIONS.weeks).doc(weekId);

      await db.runTransaction(async (tx) => {
        const [weekSnap, guessSnap] = await Promise.all([tx.get(weekRef), tx.get(guessRef)]);
        if (weekSnap.exists && String(weekSnap.data()?.status || 'open') !== 'open') {
          throw publicError('Guesses are closed for this Saturday.', 409);
        }
        if (guessSnap.exists) {
          throw publicError(`${name} has already entered a guess for this Saturday.`, 409);
        }
        if (!weekSnap.exists) tx.set(weekRef, newWeekRecord(weekId, admin));
        tx.set(guessRef, {
          weekId,
          playerName: name,
          playerKey,
          guessTime,
          submittedAt: admin.firestore.FieldValue.serverTimestamp(),
          calculated: false,
          difference: null,
          rank: null,
          points: null,
          exactGuess: false,
          weeklyWin: false,
        });
      });

      return res.status(201).json({ success: true, message: 'Guess entered.', ...(await buildState(db, admin, DateTime)) });
    } catch (error) {
      return sendKnownError(res, error, 'Could not save the guess.');
    }
  });

  app.post('/api/whens-wen/admin/arrival', adminLimit, requireAdmin, async (req, res) => {
    const db = dbOrNull();
    if (!db) return databaseUnavailable(res);
    try {
      const actualTime = normalizeTime(req.body?.time);
      if (!actualTime) return res.status(400).json({ success: false, error: 'Choose a valid arrival time.' });
      await ensureLegacySeed(db, admin, DateTime);
      await calculateWeek(db, admin, currentWeekId(DateTime), actualTime);
      return res.json({ success: true, message: 'Result calculated.', ...(await buildState(db, admin, DateTime)) });
    } catch (error) {
      return sendKnownError(res, error, 'Could not calculate the result.');
    }
  });

  app.post('/api/whens-wen/admin/close', adminLimit, requireAdmin, async (_req, res) => {
    const db = dbOrNull();
    if (!db) return databaseUnavailable(res);
    try {
      await ensureLegacySeed(db, admin, DateTime);
      const weekId = currentWeekId(DateTime);
      const ref = db.collection(COLLECTIONS.weeks).doc(weekId);
      const snap = await ref.get();
      if (snap.exists && snap.data()?.status === 'calculated') {
        throw publicError('This Saturday has already been calculated.', 409);
      }
      await ref.set({
        ...newWeekRecord(weekId, admin),
        status: 'closed',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return res.json({ success: true, message: 'Guesses closed.', ...(await buildState(db, admin, DateTime)) });
    } catch (error) {
      return sendKnownError(res, error, 'Could not close guesses.');
    }
  });

  app.post('/api/whens-wen/admin/reopen', adminLimit, requireAdmin, async (_req, res) => {
    const db = dbOrNull();
    if (!db) return databaseUnavailable(res);
    try {
      await ensureLegacySeed(db, admin, DateTime);
      const weekId = currentWeekId(DateTime);
      const ref = db.collection(COLLECTIONS.weeks).doc(weekId);
      const snap = await ref.get();
      if (snap.exists && snap.data()?.status === 'calculated') {
        throw publicError('Reset this Saturday before reopening it.', 409);
      }
      await ref.set({
        ...newWeekRecord(weekId, admin),
        status: 'open',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return res.json({ success: true, message: 'Guesses reopened.', ...(await buildState(db, admin, DateTime)) });
    } catch (error) {
      return sendKnownError(res, error, 'Could not reopen guesses.');
    }
  });

  app.post('/api/whens-wen/admin/reset', adminLimit, requireAdmin, async (_req, res) => {
    const db = dbOrNull();
    if (!db) return databaseUnavailable(res);
    try {
      await ensureLegacySeed(db, admin, DateTime);
      const weekId = currentWeekId(DateTime);
      const snapshot = await db.collection(COLLECTIONS.guesses).where('weekId', '==', weekId).get();
      await deleteSnapshotInBatches(db, snapshot);
      await db.collection(COLLECTIONS.weeks).doc(weekId).set(newWeekRecord(weekId, admin));
      return res.json({ success: true, message: 'This Saturday was reset.', ...(await buildState(db, admin, DateTime)) });
    } catch (error) {
      return sendKnownError(res, error, 'Could not reset this Saturday.');
    }
  });

  console.log('[WHENS_WEN] Routes installed at /whens-wen and /api/whens-wen/*');
}

async function ensureLegacySeed(db, admin, DateTime) {
  const markerRef = db.collection(COLLECTIONS.meta).doc('legacy_seed_v1');
  if ((await markerRef.get()).exists) return;

  const existing = await db.collection(COLLECTIONS.guesses).limit(1).get();
  if (!existing.empty) {
    await markerRef.set({
      skipped: true,
      reason: 'existing-data',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return;
  }

  const batch = db.batch();
  for (const week of LEGACY_WEEKS) {
    batch.set(db.collection(COLLECTIONS.weeks).doc(week.weekId), {
      weekId: week.weekId,
      saturdayDate: week.weekId,
      status: week.status,
      actualArrivalTime: week.actualArrivalTime || null,
      winnerSummary: '',
      calculatedAt: week.calculatedAt ? admin.firestore.Timestamp.fromDate(new Date(week.calculatedAt)) : null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  for (const [weekId, playerName, guessTime, submittedAt] of LEGACY_GUESSES) {
    const playerKey = normalizePlayerKey(playerName);
    batch.set(db.collection(COLLECTIONS.guesses).doc(guessDocumentId(weekId, playerKey)), {
      weekId,
      playerName,
      playerKey,
      guessTime,
      submittedAt: admin.firestore.Timestamp.fromDate(new Date(submittedAt)),
      calculated: false,
      difference: null,
      rank: null,
      points: null,
      exactGuess: false,
      weeklyWin: false,
    }, { merge: true });
  }

  await batch.commit();
  for (const week of LEGACY_WEEKS.filter((item) => item.status === 'calculated' && item.actualArrivalTime)) {
    await calculateWeek(db, admin, week.weekId, week.actualArrivalTime);
  }
  await markerRef.set({
    seeded: true,
    source: 'legacy-google-sheet',
    timezone: ZONE,
    appWeekAtSeed: currentWeekId(DateTime),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function buildState(db, admin, DateTime) {
  const weekId = currentWeekId(DateTime);
  const weekRef = db.collection(COLLECTIONS.weeks).doc(weekId);
  let weekSnap = await weekRef.get();
  if (!weekSnap.exists) {
    await weekRef.set(newWeekRecord(weekId, admin));
    weekSnap = await weekRef.get();
  }

  const [guessSnapshot, calculatedSnapshot] = await Promise.all([
    db.collection(COLLECTIONS.guesses).where('weekId', '==', weekId).get(),
    db.collection(COLLECTIONS.guesses).where('calculated', '==', true).get(),
  ]);

  const guesses = guessSnapshot.docs
    .map((doc) => ({ id: doc.id, ...serializeGuess(doc.data()) }))
    .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999) || String(a.guessTime).localeCompare(String(b.guessTime)) || String(a.playerName).localeCompare(String(b.playerName)));
  const week = weekSnap.data() || newWeekRecord(weekId, admin);

  return {
    weekId,
    saturdayLabel: DateTime.fromISO(weekId, { zone: ZONE }).toFormat('cccc, d LLLL yyyy'),
    status: String(week.status || 'open'),
    guessesOpen: String(week.status || 'open') === 'open',
    actualArrivalTime: week.actualArrivalTime || '',
    winnerSummary: week.winnerSummary || '',
    guesses,
    leaderboard: aggregateLeaderboard(calculatedSnapshot.docs.map((doc) => doc.data())),
    scoring: { validGuess: 1, first: 5, second: 3, third: 2, exact: 3 },
    timezone: ZONE,
  };
}

async function calculateWeek(db, admin, weekId, actualTime) {
  const snapshot = await db.collection(COLLECTIONS.guesses).where('weekId', '==', weekId).get();
  const scored = scoreGuesses(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })), actualTime);
  const batch = db.batch();
  for (const item of scored) {
    batch.set(db.collection(COLLECTIONS.guesses).doc(item.id), {
      calculated: true,
      difference: item.difference,
      rank: item.rank,
      points: item.points,
      exactGuess: item.exactGuess,
      weeklyWin: item.weeklyWin,
      calculatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  await batch.commit();

  const winners = scored.filter((item) => item.weeklyWin);
  const winnerSummary = winners.length
    ? `${winners.map((item) => item.playerName).join(' & ')} won — ${winners[0].guessTime} (${winners[0].difference} minute${winners[0].difference === 1 ? '' : 's'} away).`
    : 'No guesses were entered.';

  await db.collection(COLLECTIONS.weeks).doc(weekId).set({
    weekId,
    saturdayDate: weekId,
    status: 'calculated',
    actualArrivalTime: actualTime,
    winnerSummary,
    calculatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

function newWeekRecord(weekId, admin) {
  return {
    weekId,
    saturdayDate: weekId,
    status: 'open',
    actualArrivalTime: null,
    winnerSummary: '',
    calculatedAt: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

function rateLimit(store, maxRequests, windowMs) {
  return (req, res, next) => {
    const now = Date.now();
    const key = String(req.ip || req.headers['x-forwarded-for'] || 'unknown');
    const bucket = store.get(key) || { startedAt: now, count: 0 };
    if (now - bucket.startedAt > windowMs) {
      bucket.startedAt = now;
      bucket.count = 0;
    }
    bucket.count += 1;
    store.set(key, bucket);
    if (bucket.count > maxRequests) {
      return res.status(429).json({ success: false, error: 'Too many requests. Try again shortly.' });
    }
    return next();
  };
}

async function deleteSnapshotInBatches(db, snapshot) {
  let batch = db.batch();
  let count = 0;
  for (const doc of snapshot.docs) {
    batch.delete(doc.ref);
    count += 1;
    if (count >= 450) {
      await batch.commit();
      batch = db.batch();
      count = 0;
    }
  }
  if (count) await batch.commit();
}

function databaseUnavailable(res) {
  return res.status(503).json({ success: false, error: "When's Wen database is temporarily unavailable." });
}

function sendKnownError(res, error, fallback) {
  if (error?.publicStatus) {
    return res.status(error.publicStatus).json({ success: false, error: error.message });
  }
  console.error('[WHENS_WEN] request failed:', error);
  return res.status(500).json({ success: false, error: fallback });
}
