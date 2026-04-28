import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'na4qizroum13ep8ua6w67dmwt5cl8a';
const JOB_ID = process.env.JOB_ID || process.argv[2] || '4wSosqJyGhG9Fe9p27td';
const AGENT_URL =
  process.env.AGENT_URL || 'https://fairwaysniper-production.up.railway.app';
const HOSTING_URL =
  process.env.HOSTING_URL || 'https://na4qizroum13ep8ua6w67dmwt5cl8a.web.app';
const POLL_MS = Number.parseInt(process.env.POLL_MS || '5000', 10);
const OUT_DIR =
  process.env.OUT_DIR || path.join(process.cwd(), 'output', 'live-attempts', JOB_ID);

function convertValue(value) {
  if (!value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('booleanValue' in value) return value.booleanValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(convertValue);
  if ('mapValue' in value) {
    return Object.fromEntries(
      Object.entries(value.mapValue.fields || {}).map(([key, child]) => [
        key,
        convertValue(child),
      ]),
    );
  }
  return value;
}

async function getFirebaseAccessToken() {
  const configPath = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
  const raw = await fs.readFile(configPath, 'utf8');
  const config = JSON.parse(raw);
  const token = config.tokens?.access_token;
  if (!token) throw new Error(`No Firebase CLI access token found in ${configPath}`);
  return token;
}

async function readFirestoreDoc(token, collection, docId) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collection}/${docId}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const json = await resp.json();
  if (!resp.ok) {
    return { _error: `${resp.status} ${JSON.stringify(json)}` };
  }
  return Object.fromEntries(
    Object.entries(json.fields || {}).map(([key, value]) => [key, convertValue(value)]),
  );
}

async function readRuntime() {
  const resp = await fetch(`${AGENT_URL}/api/runtime-status`);
  const json = await resp.json();
  if (!resp.ok) throw new Error(`runtime-status ${resp.status}: ${JSON.stringify(json)}`);
  return json;
}

function summarize(snapshot) {
  const runtime = snapshot.runtime || {};
  const job = snapshot.job || {};
  return [
    snapshot.observed_at,
    `git=${String(runtime.gitHash || '').slice(0, 7)}`,
    `safe=${runtime.safeMode}`,
    `timers=${runtime.activeSniperTimers}`,
    `status=${job.status}/${job.state}`,
    `warm=${job.warm_state}`,
    `booked=${job.booked_time || '-'}`,
    `result=${job.result || '-'}`,
    `release_ms=${job.release_detect_delta_ms ?? '-'}`,
    `click_ms=${job.click_delta_ms ?? '-'}`,
    `verify=${job.verification_signal || '-'}`,
    `error=${job.error_message || '-'}`,
  ].join(' | ');
}

async function appendJsonl(filePath, object) {
  await fs.appendFile(filePath, `${JSON.stringify(object)}\n`, 'utf8');
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const token = await getFirebaseAccessToken();
  const logPath = path.join(OUT_DIR, 'monitor.jsonl');
  const summaryPath = path.join(OUT_DIR, 'summary.log');
  const metaPath = path.join(OUT_DIR, 'meta.json');

  await fs.writeFile(
    metaPath,
    JSON.stringify(
      {
        jobId: JOB_ID,
        projectId: PROJECT_ID,
        agentUrl: AGENT_URL,
        hostingUrl: HOSTING_URL,
        pollMs: POLL_MS,
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf8',
  );

  console.log(`Monitoring job ${JOB_ID}`);
  console.log(`Writing ${logPath}`);

  while (true) {
    const observedAt = new Date().toISOString();
    let snapshot;
    try {
      const [runtime, job] = await Promise.all([
        readRuntime(),
        readFirestoreDoc(token, 'jobs', JOB_ID),
      ]);
      snapshot = { observed_at: observedAt, runtime, job };
    } catch (error) {
      snapshot = { observed_at: observedAt, error: error?.message || String(error) };
    }

    await appendJsonl(logPath, snapshot);
    const line = snapshot.error
      ? `${snapshot.observed_at} | ERROR ${snapshot.error}`
      : summarize(snapshot);
    await fs.appendFile(summaryPath, `${line}\n`, 'utf8');
    console.log(line);

    const status = String(snapshot.job?.status || '').toLowerCase();
    const state = String(snapshot.job?.state || '').toLowerCase();
    if (['finished', 'error'].includes(status) || ['finished', 'error'].includes(state)) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
