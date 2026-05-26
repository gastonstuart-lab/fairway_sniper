import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import admin from 'firebase-admin';

const JOB_ID = process.env.JOB_ID || process.argv[2];
const AGENT_URL = process.env.AGENT_URL || 'https://fairwaysniper-production.up.railway.app';
const POLL_MS = Number.parseInt(process.env.POLL_MS || '1000', 10);
const OUT_DIR =
  process.env.OUT_DIR || path.resolve('..', 'output', 'live-attempts', JOB_ID || 'unknown');

if (!JOB_ID) {
  console.error('Usage: JOB_ID=<id> node monitor-job-admin.mjs');
  process.exit(1);
}

function normalizeFirebasePrivateKey(value) {
  return String(value || '')
    .replace(/\\\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .trim();
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: normalizeFirebasePrivateKey(process.env.FIREBASE_PRIVATE_KEY),
    }),
  });
}

const db = admin.firestore();

function toPlain(value) {
  if (!value) return value ?? null;
  if (value.toDate) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(toPlain);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, toPlain(child)]));
  }
  return value;
}

function redact(job) {
  const copy = { ...job };
  if (copy.brs_password) copy.brs_password = '[redacted]';
  if (copy.brs_email) copy.brs_email = '[redacted]';
  if (copy.push_token) copy.push_token = '[redacted]';
  return copy;
}

async function readRuntime() {
  const response = await fetch(`${AGENT_URL}/api/runtime-status`);
  const body = await response.json();
  if (!response.ok) throw new Error(`runtime-status ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

function lineFor(snapshot) {
  const job = snapshot.job || {};
  const runtime = snapshot.runtime || {};
  return [
    snapshot.observed_at,
    `git=${String(runtime.gitHash || '').slice(0, 7)}`,
    `timers=${runtime.activeSniperTimers}`,
    `status=${job.status}/${job.state}`,
    `target=${job.target_date}`,
    `times=${Array.isArray(job.preferred_times) ? job.preferred_times.join(',') : job.preferred_times}`,
    `warm=${job.warm_state}`,
    `booked=${job.booked_time || '-'}`,
    `result=${job.result || '-'}`,
    `release_ms=${job.release_detect_delta_ms ?? '-'}`,
    `click_ms=${job.click_delta_ms ?? '-'}`,
    `verify=${job.verification_signal || '-'}`,
    `error=${job.error_message || '-'}`,
  ].join(' | ');
}

await fs.mkdir(OUT_DIR, { recursive: true });
const jsonlPath = path.join(OUT_DIR, 'admin-monitor.jsonl');
const summaryPath = path.join(OUT_DIR, 'admin-summary.log');
await fs.writeFile(
  path.join(OUT_DIR, 'admin-monitor-meta.json'),
  JSON.stringify({ jobId: JOB_ID, agentUrl: AGENT_URL, pollMs: POLL_MS, startedAt: new Date().toISOString() }, null, 2),
);

console.log(`Admin monitoring ${JOB_ID}`);
console.log(`Writing ${jsonlPath}`);

while (true) {
  const observedAt = new Date().toISOString();
  let snapshot;
  try {
    const [runtime, doc] = await Promise.all([readRuntime(), db.collection('jobs').doc(JOB_ID).get()]);
    const rawJob = doc.exists ? doc.data() : { missing: true };
    snapshot = {
      observed_at: observedAt,
      runtime,
      job: redact(toPlain(rawJob)),
    };
  } catch (error) {
    snapshot = { observed_at: observedAt, error: error?.message || String(error) };
  }

  await fs.appendFile(jsonlPath, `${JSON.stringify(snapshot)}\n`);
  const line = snapshot.error ? `${observedAt} | ERROR ${snapshot.error}` : lineFor(snapshot);
  await fs.appendFile(summaryPath, `${line}\n`);
  console.log(line);

  const status = String(snapshot.job?.status || '').toLowerCase();
  const state = String(snapshot.job?.state || '').toLowerCase();
  if (['finished', 'error'].includes(status) || ['finished', 'error'].includes(state)) break;
  await new Promise((resolve) => setTimeout(resolve, POLL_MS));
}
