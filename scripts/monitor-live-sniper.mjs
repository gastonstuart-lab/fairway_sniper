import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'na4qizroum13ep8ua6w67dmwt5cl8a';
const JOB_ID = process.env.JOB_ID || process.argv[2] || '4wSosqJyGhG9Fe9p27td';
const AGENT_URL =
  process.env.AGENT_URL || 'https://fairwaysniper-production.up.railway.app';
const HOSTING_URL =
  process.env.HOSTING_URL || 'https://na4qizroum13ep8ua6w67dmwt5cl8a.web.app';
const POLL_MS = Number.parseInt(process.env.POLL_MS || '5000', 10);
const SCREENSHOT_MS = Number.parseInt(process.env.SCREENSHOT_MS || '60000', 10);
const OUT_DIR =
  process.env.OUT_DIR || path.join(process.cwd(), 'output', 'live-attempts', JOB_ID);
const SENSITIVE_KEY_RE = /password|passcode|secret|private|credential|token|brs_email|brsemail|username/i;

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

function redactSensitive(value, key = '') {
  if (SENSITIVE_KEY_RE.test(key)) return '[redacted]';
  if (Array.isArray(value)) return value.map((entry) => redactSensitive(entry));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      redactSensitive(childValue, childKey),
    ]),
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

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function valueOrDash(value) {
  return value === null || value === undefined || value === '' ? '-' : value;
}

function statusSignature(snapshot) {
  const runtime = snapshot.runtime || {};
  const job = snapshot.job || {};
  return JSON.stringify({
    gitHash: runtime.gitHash,
    safeMode: runtime.safeMode,
    activeSniperTimers: runtime.activeSniperTimers,
    status: job.status,
    state: job.state,
    warmState: job.warm_state,
    bookedTime: job.booked_time,
    result: job.result,
    releaseMs: job.release_detect_delta_ms,
    clickMs: job.click_delta_ms,
    verificationSignal: job.verification_signal,
    errorMessage: job.error_message,
  });
}

function renderStatusHtml(snapshot) {
  const runtime = snapshot.runtime || {};
  const job = snapshot.job || {};
  const rows = [
    ['Observed', snapshot.observed_at],
    ['Agent git', runtime.gitHash],
    ['Safe mode', runtime.safeMode],
    ['Firebase Admin', runtime.firebaseAdminReady],
    ['Runner started', runtime.sniperRunnerStarted],
    ['Active timers', runtime.activeSniperTimers],
    ['Job ID', JOB_ID],
    ['Job status', `${valueOrDash(job.status)} / ${valueOrDash(job.state)}`],
    ['Scheduled for UTC', job.scheduled_for],
    ['Warm state', job.warm_state],
    ['Claimed by', job.claimed_by],
    ['Resume count', job.resume_count],
    ['Target date', job.target_date],
    ['Preferred times', Array.isArray(job.preferred_times) ? job.preferred_times.join(', ') : job.preferred_times],
    ['Players', Array.isArray(job.players) ? job.players.join(', ') : job.players],
    ['Booked time', job.booked_time],
    ['Result', job.result],
    ['Release detect delta ms', job.release_detect_delta_ms],
    ['Click delta ms', job.click_delta_ms],
    ['Verification signal', job.verification_signal],
    ['Verification URL', job.verification_url],
    ['Error', job.error_message],
    ['Railway snapshot path', job.snapshot_path],
    ['Railway screenshot path', job.screenshot_path],
  ];

  const rowHtml = rows
    .map(
      ([label, value]) =>
        `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(valueOrDash(value))}</td></tr>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Fairway Sniper Live Evidence</title>
  <style>
    body { margin: 0; font-family: Segoe UI, Arial, sans-serif; background: #101820; color: #f4f7f5; }
    main { padding: 28px; max-width: 1120px; margin: 0 auto; }
    h1 { margin: 0 0 6px; font-size: 30px; font-weight: 650; }
    .sub { color: #a9b9b2; margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; background: #17242d; border: 1px solid #31434d; }
    th, td { text-align: left; vertical-align: top; padding: 10px 12px; border-bottom: 1px solid #263a44; font-size: 14px; }
    th { width: 230px; color: #90d99b; font-weight: 600; }
    td { color: #f7fbf8; word-break: break-word; }
    .ok { color: #79e18b; }
    .danger { color: #ff7777; }
    pre { white-space: pre-wrap; background: #0b1117; padding: 14px; border: 1px solid #31434d; overflow-wrap: anywhere; }
  </style>
</head>
<body>
  <main>
    <h1>Fairway Sniper Live Evidence</h1>
    <div class="sub">Railway and Firestore snapshot for job ${escapeHtml(JOB_ID)}</div>
    <table>${rowHtml}</table>
    <h2>Raw Snapshot</h2>
    <pre>${escapeHtml(JSON.stringify(snapshot, null, 2))}</pre>
  </main>
</body>
</html>`;
}

async function loadChromium() {
  const candidates = [
    path.join(process.cwd(), 'automation', 'node_modules', '@playwright', 'test', 'index.js'),
    path.join(process.cwd(), 'agent', 'node_modules', '@playwright', 'test', 'index.js'),
  ];
  for (const candidate of candidates) {
    try {
      const mod = await import(pathToFileURL(candidate).href);
      if (mod.chromium) return mod.chromium;
      if (mod.default?.chromium) return mod.default.chromium;
    } catch {
      // Try the next installed Playwright package.
    }
  }
  return null;
}

async function captureStatusScreenshot(snapshot, chromium, reason) {
  const htmlPath = path.join(OUT_DIR, 'latest-status.html');
  const screenshotsDir = path.join(OUT_DIR, 'screenshots');
  await fs.mkdir(screenshotsDir, { recursive: true });
  await fs.writeFile(htmlPath, renderStatusHtml(snapshot), 'utf8');
  if (!chromium) return null;

  const stamp = snapshot.observed_at.replace(/[:.]/g, '-');
  const screenshotPath = path.join(screenshotsDir, `${stamp}-${reason}.png`);
  const latestPath = path.join(OUT_DIR, 'latest-status.png');
  const launchAttempts = [
    () => chromium.launch({ channel: 'chrome', headless: true }),
    () => chromium.launch({ channel: 'msedge', headless: true }),
    () => chromium.launch({ headless: true }),
  ];
  let browser = null;
  let lastError = null;
  for (const launch of launchAttempts) {
    try {
      browser = await launch();
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!browser) throw lastError || new Error('Unable to launch browser for screenshot');
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await page.screenshot({ path: latestPath, fullPage: true });
    return screenshotPath;
  } finally {
    await browser.close();
  }
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const token = await getFirebaseAccessToken();
  const chromium = await loadChromium();
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
        screenshotMs: SCREENSHOT_MS,
        screenshotsEnabled: Boolean(chromium),
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf8',
  );

  console.log(`Monitoring job ${JOB_ID}`);
  console.log(`Writing ${logPath}`);
  console.log(`Screenshots ${chromium ? 'enabled' : 'disabled'} (${OUT_DIR})`);

  let lastSignature = '';
  let lastScreenshotAt = 0;
  while (true) {
    const observedAt = new Date().toISOString();
    let snapshot;
    try {
      const [runtime, job] = await Promise.all([
        readRuntime(),
        readFirestoreDoc(token, 'jobs', JOB_ID),
      ]);
      snapshot = { observed_at: observedAt, runtime, job: redactSensitive(job) };
    } catch (error) {
      snapshot = { observed_at: observedAt, error: error?.message || String(error) };
    }

    await appendJsonl(logPath, snapshot);
    const line = snapshot.error
      ? `${snapshot.observed_at} | ERROR ${snapshot.error}`
      : summarize(snapshot);
    await fs.appendFile(summaryPath, `${line}\n`, 'utf8');
    console.log(line);

    if (!snapshot.error) {
      const signature = statusSignature(snapshot);
      const nowMs = Date.now();
      const shouldScreenshot =
        signature !== lastSignature || nowMs - lastScreenshotAt >= SCREENSHOT_MS;
      if (shouldScreenshot) {
        const reason = signature !== lastSignature ? 'change' : 'interval';
        try {
          const screenshotPath = await captureStatusScreenshot(snapshot, chromium, reason);
          if (screenshotPath) {
            await fs.appendFile(summaryPath, `${observedAt} | screenshot=${screenshotPath}\n`, 'utf8');
            console.log(`${observedAt} | screenshot=${screenshotPath}`);
          }
          lastScreenshotAt = nowMs;
          lastSignature = signature;
        } catch (error) {
          console.warn(`status screenshot failed: ${error?.message || error}`);
        }
      }
    }

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
