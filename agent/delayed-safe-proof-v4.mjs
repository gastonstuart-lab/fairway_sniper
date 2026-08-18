import 'dotenv/config';
import admin from 'firebase-admin';

const PROOF_JOB_ID = 'safe-prep-proof-20260818-v4';
const SOURCE_JOB_ID = 'IOjhrgHbPR5ZttcgyUXz';
const TARGET_DATE = '2026-08-24';
const TARGET_TIME = '11:08';
const CREATE_DELAY_MS = 120_000;
const FIRE_DELAY_AFTER_CREATE_MS = 360_000;

function normalizePrivateKey(value) {
  return String(value || '').replace(/\\n/g, '\n').trim();
}

async function createSafeProof() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);

  if (!projectId || !clientEmail || !privateKey) {
    console.log('[SAFE_PROOF_V4] skipped: Firebase Admin env unavailable');
    return;
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    });
  }
  const db = admin.firestore();
  const proofRef = db.collection('jobs').doc(PROOF_JOB_ID);
  if ((await proofRef.get()).exists) {
    console.log(`[SAFE_PROOF_V4] ${PROOF_JOB_ID} already exists; no duplicate created`);
    return;
  }

  const sourceSnap = await db.collection('jobs').doc(SOURCE_JOB_ID).get();
  if (!sourceSnap.exists) throw new Error(`source job ${SOURCE_JOB_ID} not found`);
  const source = sourceSnap.data() || {};
  const ownerUid = source.ownerUid || source.owner_uid || null;
  const partySize = Number(source.party_size ?? source.partySize ?? 1);
  const players = Array.isArray(source.players) ? source.players : [];
  const hasEmbeddedCredentials = Boolean(source.brs_email && source.brs_password);

  if (!ownerUid && !hasEmbeddedCredentials) throw new Error('source job has no credential path');
  if (!Number.isFinite(partySize) || partySize < 1 || partySize > 4) {
    throw new Error(`invalid party size ${partySize}`);
  }
  if (players.length !== Math.max(0, partySize - 1)) {
    throw new Error(`party/player mismatch party=${partySize} players=${players.length}`);
  }

  const fireAt = new Date(Date.now() + FIRE_DELAY_AFTER_CREATE_MS);
  const [year, month, day] = TARGET_DATE.split('-').map(Number);
  const payload = {
    ownerUid,
    mode: 'sniper',
    status: 'active',
    state: 'queued',
    club: source.club || 'galgorm',
    tz: source.tz || source.timezone || 'Europe/London',
    release_day: source.release_day || source.releaseDay || 'Wednesday',
    release_time_local: source.release_time_local || source.releaseTimeLocal || '19:20',
    target_day: 'Monday',
    target_date: TARGET_DATE,
    target_play_date: admin.firestore.Timestamp.fromDate(new Date(Date.UTC(year, month - 1, day))),
    preferred_times: [TARGET_TIME],
    players,
    party_size: partySize,
    tee: 1,
    tee_target: 1,
    tee_mode: source.tee_mode || source.teeMode || 'single',
    fallback_tee: false,
    dry_run: true,
    proof_run: true,
    proof_label: 'safe_production_proof',
    proof_template_job_id: SOURCE_JOB_ID,
    proof_candidate_date: TARGET_DATE,
    proof_candidate_time: TARGET_TIME,
    proof_candidate_tee: 1,
    proof_party_size: partySize,
    proof_fire_delay_ms: FIRE_DELAY_AFTER_CREATE_MS,
    proof_fire_time_override_utc: admin.firestore.Timestamp.fromDate(fireAt),
    created_at: admin.firestore.FieldValue.serverTimestamp(),
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (hasEmbeddedCredentials) {
    payload.brs_email = source.brs_email;
    payload.brs_password = source.brs_password;
  }

  try {
    await proofRef.create(payload);
  } catch (error) {
    if (error?.code === 6 || /already exists/i.test(error?.message || '')) {
      console.log(`[SAFE_PROOF_V4] ${PROOF_JOB_ID} already exists; no duplicate created`);
      return;
    }
    throw error;
  }

  console.log(`[SAFE_PROOF_V4] created ${PROOF_JOB_ID} after rollout-settle delay`);
  console.log(`[SAFE_PROOF_V4] target=${TARGET_DATE} ${TARGET_TIME} tee=1 dry_run=true proof_run=true`);
  console.log(`[SAFE_PROOF_V4] fire=${fireAt.toISOString()}`);
}

const firebaseEnvPresent = Boolean(
  process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY,
);

if (firebaseEnvPresent) {
  console.log(`[SAFE_PROOF_V4] creation scheduled in ${CREATE_DELAY_MS}ms so Railway rollout can settle`);
  const timer = setTimeout(() => {
    createSafeProof().catch((error) => {
      console.error(`[SAFE_PROOF_V4] failed safely: ${error?.message || String(error)}`);
    });
  }, CREATE_DELAY_MS);
  timer.unref?.();
} else {
  console.log('[SAFE_PROOF_V4] not scheduled outside Firebase production environment');
}
