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

const brsEmail = process.env.BRS_EMAIL || process.env.BRS_USERNAME;
const brsPassword = process.env.BRS_PASSWORD;
const club = process.env.BRS_CLUB || 'galgorm';
const tz = process.env.BRS_TZ || 'Europe/London';

if (!brsEmail || !brsPassword) {
  console.error('Missing BRS_EMAIL/BRS_PASSWORD env vars for test job.');
  process.exit(1);
}

const now = DateTime.now().setZone(tz);
const targetPlayDate = process.env.TARGET_PLAY_DATE
  ? DateTime.fromISO(process.env.TARGET_PLAY_DATE, { zone: tz })
  : now.plus({ days: 7 });

const fireTime = now.plus({ minutes: 4 });

const job = {
  ownerUid: 'local-test',
  brs_email: brsEmail,
  brs_password: brsPassword,
  club,
  tz,
  release_day: fireTime.toFormat('cccc'),
  release_time_local: fireTime.toFormat('HH:mm'),
  target_day: targetPlayDate.toFormat('cccc'),
  preferred_times: ['08:20'],
  players: [],
  party_size: 1,
  status: 'active',
  mode: 'sniper',
  next_fire_time_utc: admin.firestore.Timestamp.fromDate(fireTime.toUTC().toJSDate()),
  target_play_date: admin.firestore.Timestamp.fromDate(targetPlayDate.toJSDate()),
  release_window_start: admin.firestore.Timestamp.fromDate(fireTime.toUTC().toJSDate()),
  created_at: admin.firestore.Timestamp.now(),
  updated_at: admin.firestore.Timestamp.now(),
};

const docRef = await db.collection('jobs').add(job);

console.log(`✅ Test sniper job created: ${docRef.id}`);
console.log('Next steps:');
console.log('1) Start agent with AGENT_RUN_MAIN=true');
console.log('2) Run this script');
console.log('3) Watch job fields transition running → finished/error');
