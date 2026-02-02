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

const targetPlayDate = DateTime.fromISO('2026-02-02', { zone: tz }).startOf('day');
const baseFireTime = DateTime.utc().plus({ minutes: 2 });

const preferredTimes = ['08:20', '11:40', '12:20'];

const created = [];
for (let i = 0; i < preferredTimes.length; i++) {
  const fireTime = baseFireTime.plus({ minutes: i * 2 });
  const job = {
    ownerUid: 'local-test',
    brs_email: brsEmail,
    brs_password: brsPassword,
    club,
    tz,
    release_day: fireTime.setZone(tz).toFormat('cccc'),
    release_time_local: fireTime.setZone(tz).toFormat('HH:mm'),
    target_day: targetPlayDate.toFormat('cccc'),
    preferred_times: [preferredTimes[i]],
    players: [],
    party_size: 1,
    dry_run: true,
    status: 'active',
    mode: 'sniper',
    fire_time_utc: admin.firestore.Timestamp.fromDate(fireTime.toJSDate()),
    target_play_date: admin.firestore.Timestamp.fromDate(targetPlayDate.toJSDate()),
    created_at: admin.firestore.Timestamp.now(),
    updated_at: admin.firestore.Timestamp.now(),
  };

  const docRef = await db.collection('jobs').add(job);
  created.push({ id: docRef.id, preferred_time: preferredTimes[i], fire_time_utc: fireTime.toISO() });
}

console.log('✅ Test sniper jobs created:');
for (const job of created) {
  console.log(`- ${job.id} | ${job.preferred_time} | ${job.fire_time_utc}`);
}
