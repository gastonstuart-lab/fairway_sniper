import 'dotenv/config';
import admin from 'firebase-admin';

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
const ids = process.argv.slice(2).filter(Boolean);
if (!ids.length) {
  console.error('Usage: node scripts/close-jobs.js <jobId> [jobId...]');
  process.exit(1);
}

for (const id of ids) {
  await db.collection('jobs').doc(id).update({
    status: 'error',
    state: 'error',
    error_message: 'closed-stale-job',
    finished_at: admin.firestore.FieldValue.serverTimestamp(),
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`Closed job ${id}`);
}
