import 'dotenv/config';
import admin from 'firebase-admin';
import { DateTime } from 'luxon';

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY;

if (!projectId || !clientEmail || !privateKey) {
  console.error('Firebase Admin not configured. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY.');
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey: privateKey.replace(/\\n/g, '\n'),
    }),
  });
}

const db = admin.firestore();

const argMap = Object.fromEntries(
  process.argv
    .slice(2)
    .map((arg) => arg.split('=', 2))
    .filter(([k]) => k && k.startsWith('--'))
    .map(([k, v]) => [k.replace(/^--/, ''), v])
);

const brsEmail = argMap.brsEmail || process.env.BRS_EMAIL || process.env.BRS_USERNAME;
const brsPassword = argMap.brsPassword || process.env.BRS_PASSWORD;
const club = argMap.club || process.env.BRS_CLUB || 'galgorm';
const tz = argMap.tz || process.env.BRS_TZ || 'Europe/London';

if (!brsEmail || !brsPassword) {
  console.error('Missing BRS_EMAIL/BRS_PASSWORD env vars for test job.');
  process.exit(1);
}

const targetPlayDateIso = argMap.targetPlayDate || process.env.TARGET_PLAY_DATE || '2026-02-02';
const preferredTimes = (argMap.preferredTimes || process.env.PREFERRED_TIMES || '08:20')
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean);
const players = (argMap.players || process.env.PLAYERS || '')
  .split(',')
  .map((p) => p.trim())
  .filter(Boolean);
const partySize = Number(argMap.partySize || process.env.PARTY_SIZE || '1');
const ownerUid = argMap.ownerUid || process.env.OWNER_UID || 'local-test';

const targetPlayDate = DateTime.fromISO(targetPlayDateIso, { zone: tz }).startOf('day');
const releaseTimeLocal = argMap.releaseTimeLocal || process.env.RELEASE_TIME_LOCAL || '19:20';
const [releaseHour, releaseMinute] = releaseTimeLocal.split(':').map((v) => Number(v));
const releaseDateTime = targetPlayDate.minus({ days: 5 }).set({
  hour: releaseHour,
  minute: releaseMinute,
  second: 0,
  millisecond: 0,
});

const job = {
  ownerUid,
  brs_email: brsEmail,
  brs_password: brsPassword,
  club,
  tz,
  release_day: releaseDateTime.toFormat('cccc'),
  release_time_local: releaseDateTime.toFormat('HH:mm'),
  target_day: targetPlayDate.toFormat('cccc'),
  preferred_times: preferredTimes,
  players,
  party_size: partySize,
  status: 'active',
  mode: 'sniper',
  target_play_date: admin.firestore.Timestamp.fromDate(targetPlayDate.toJSDate()),
  release_window_start: admin.firestore.Timestamp.fromDate(releaseDateTime.toUTC().toJSDate()),
  created_at: admin.firestore.Timestamp.now(),
  updated_at: admin.firestore.Timestamp.now(),
};

const docRef = await db.collection('jobs').add(job);

console.log(`✅ Test sniper job created: ${docRef.id}`);
console.log('Next steps:');
console.log('1) Start agent with AGENT_RUN_MAIN=true');
console.log('2) Run this script');
console.log('3) Watch job fields transition running → finished/error');
