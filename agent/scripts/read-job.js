import 'dotenv/config';
import admin from 'firebase-admin';

const jobId = process.argv[2];
if (!jobId) {
  console.error('Usage: node scripts/read-job.js <jobId>');
  process.exit(1);
}

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
const snap = await db.collection('jobs').doc(jobId).get();
if (!snap.exists) {
  console.error('Job not found:', jobId);
  process.exit(1);
}

console.log(JSON.stringify(snap.data(), null, 2));
