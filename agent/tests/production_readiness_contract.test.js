import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const agentSource = fs.readFileSync(path.join(repoRoot, 'agent', 'index.js'), 'utf8');
const dashboardSource = fs.readFileSync(
  path.join(repoRoot, 'lib', 'screens', 'dashboard_screen.dart'),
  'utf8',
);
const safeProofBuilderSource = fs.readFileSync(
  path.join(repoRoot, 'lib', 'services', 'safe_proof_builder.dart'),
  'utf8',
);
const warmSessionSource = fs.readFileSync(path.join(repoRoot, 'agent', 'warm_session.js'), 'utf8');

function functionBody(source, name) {
  const start = source.indexOf(`async function ${name}`);
  assert.notEqual(start, -1, `${name} not found`);
  const next = source.indexOf('\nasync function ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

test('scheduler registers PREP and FIRE timers before warm-up can block', () => {
  const body = functionBody(agentSource, 'scheduleClaimedJob');
  const prepTimerCreate = body.indexOf("'PREP_TIMER_CREATED'");
  const fireTimerCreate = body.indexOf("'FIRE_TIMER_CREATED'");
  const timerSet = body.indexOf('jobTimers.set(jobId');
  const prepTimeoutSet = body.indexOf('const prepTimeoutId = setTimeout');
  const fireTimeoutSet = body.indexOf('const fireTimeoutId = setTimeout');
  const warmStart = body.indexOf("fsAddJobEvent(jobId, 'WARMUP_STARTED'");
  assert(prepTimerCreate > -1, 'prep timer event missing');
  assert(fireTimerCreate > -1, 'fire timer event missing');
  assert(timerSet > -1, 'timer registration missing');
  assert(prepTimeoutSet > -1, 'prep timeout installation missing');
  assert(fireTimeoutSet > -1, 'fire timeout installation missing');
  assert(warmStart > -1, 'warm-up event missing');
  assert(timerSet < warmStart, 'timer must be registered before warm-up starts');
  assert(prepTimeoutSet < prepTimerCreate, 'prep timeout must be installed before diagnostic writes');
  assert(fireTimeoutSet < fireTimerCreate, 'fire timeout must be installed before diagnostic writes');
});

test('failed PREP warm-up retries before FIRE instead of waiting for fire recovery', () => {
  const body = functionBody(agentSource, 'scheduleClaimedJob');
  assert(body.includes('SNIPER_PREP_RETRY_INTERVAL_MS'));
  assert(body.includes('WARMUP_RETRY_SCHEDULED'));
  assert(body.includes('WARMUP_RETRY_FIRED'));
  assert(body.includes('runPrepWarmupWithRetry'));
  assert.match(body, /retryAtMs >= fireMs[\s\S]*return false/);
  assert.match(body, /await runPrepWarmupWithRetry\('prep-timer'\)/);
});

test('healthy prepared sessions are verified before FIRE and reused by the fire path', () => {
  const body = functionBody(agentSource, 'scheduleClaimedJob');
  assert(body.includes('SNIPER_PREFIRE_VERIFY_LEAD_MS'));
  assert(body.includes('PREFIRE_VERIFY_FIRED'));
  assert.match(body, /await runPrepWarmupWithRetry\('pre-fire-verify'\)/);
  assert(!body.includes("if (entry.warmState === 'ready' && warmPage) return warmPage;"));
  assert.match(body, /let fireWarmPage = warmPage;[\s\S]*if \(!fireWarmPage\)/);
});

test('warm session uses the known-good persistent browser profile', () => {
  assert(warmSessionSource.includes("path.join(agentDir, '.session', 'profile')"));
  assert(warmSessionSource.includes('chromium.launchPersistentContext(profileDir'));
  assert(!warmSessionSource.includes('warmBrowser = await chromium.launch({'));
  assert(!warmSessionSource.includes('warmContext = await warmBrowser.newContext();'));
});

test('PREP tee-sheet auth loss is repaired before declaring warm-up failure', () => {
  assert(warmSessionSource.includes('tee sheet load reached an unauthenticated page; refreshing login once'));
  assert.match(warmSessionSource, /await performLogin\(warmPage, DEFAULT_LOGIN_URL, username, password\);[\s\S]*await warmPage\.goto\(url/);
  assert.match(warmSessionSource, /throw new Error\('BRS session lost authentication while loading tee sheet'\)/);
});

test('live booking success still requires BRS confirmation after final Create Booking click', () => {
  const directBody = functionBody(agentSource, 'tryDirectBookingHref');
  const verifyBody = functionBody(agentSource, 'verifyBookingConfirmation');
  assert(directBody.includes('const verification = await verifyBookingConfirmation(page, time, 8000);'));
  assert.match(directBody, /booked:\s*verification\.confirmed\s*&&\s*!confirmationBlocked/);
  assert(verifyBody.includes("const confirmed = ['text', 'bookings-page'].includes(verificationSignal);"));
  assert(verifyBody.includes("verificationSignal = 'row-unavailable';"));
});

function finalDelay(targetMs, installedAtMs) {
  return Math.max(0, targetMs - installedAtMs);
}

test('fire timer recomputes delay after async scheduling work', () => {
  const initialNow = 1_000_000;
  const targetFireMs = initialNow + 10_000;
  const installedAtMs = initialNow + 3_000;

  assert.equal(finalDelay(targetFireMs, installedAtMs), 7_000);
  assert.notEqual(finalDelay(targetFireMs, installedAtMs), targetFireMs - initialNow);

  const body = functionBody(agentSource, 'scheduleClaimedJob');
  assert(body.includes('const fireTimerInstalledAtMs = Date.now();'));
  assert(body.includes('const fireDelayMs = Math.max(0, fireMs - fireTimerInstalledAtMs);'));
});

test('prep timer recomputes delay after async scheduling work', () => {
  const initialNow = 1_000_000;
  const targetPrepMs = initialNow + 10_000;
  const installedAtMs = initialNow + 3_000;

  assert.equal(finalDelay(targetPrepMs, installedAtMs), 7_000);

  const body = functionBody(agentSource, 'scheduleClaimedJob');
  assert(body.includes('const prepTimerInstalledAtMs = Date.now();'));
  assert(body.includes('const prepDelayMs = Math.max(0, prepMs - prepTimerInstalledAtMs);'));
});

test('no await occurs between final timer delay calculation and setTimeout installation', () => {
  const body = functionBody(agentSource, 'scheduleClaimedJob');
  const prepDelayCalc = body.indexOf('const prepDelayMs = Math.max(0, prepMs - prepTimerInstalledAtMs);');
  const prepTimeoutSet = body.indexOf('const prepTimeoutId = setTimeout', prepDelayCalc);
  const fireDelayCalc = body.indexOf('const fireDelayMs = Math.max(0, fireMs - fireTimerInstalledAtMs);');
  const fireTimeoutSet = body.indexOf('const fireTimeoutId = setTimeout', fireDelayCalc);

  assert(prepDelayCalc > -1);
  assert(prepTimeoutSet > prepDelayCalc);
  assert.equal(body.slice(prepDelayCalc, prepTimeoutSet).includes('await '), false);
  assert(fireDelayCalc > -1);
  assert(fireTimeoutSet > fireDelayCalc);
  assert.equal(body.slice(fireDelayCalc, fireTimeoutSet).includes('await '), false);
});

test('timer metadata matches the real installed timer target', () => {
  const scheduledStartAtMs = 1_010_000;
  const installedAtMs = 1_003_000;
  const delayMs = finalDelay(scheduledStartAtMs, installedAtMs);

  assert(Math.abs(installedAtMs + delayMs - scheduledStartAtMs) <= 1);

  const body = functionBody(agentSource, 'scheduleClaimedJob');
  assert(body.includes('timerCreatedAt: prepTimerInstalledAtUtc'));
  assert(body.includes('scheduledStartAt: prepAt.toISOString()'));
  assert(body.includes('timerCreatedAt: fireTimerInstalledAtUtc'));
  assert(body.includes('scheduledStartAt: scheduleAt.toISOString()'));
});

test('past PREP target recovers with immediate delay', () => {
  const targetPrepMs = 1_000_000;
  const installedAtMs = 1_003_000;

  assert.equal(finalDelay(targetPrepMs, installedAtMs), 0);

  const body = functionBody(agentSource, 'scheduleClaimedJob');
  assert(body.includes('if (prepMs <= prepTimerInstalledAtMs) timerEntry.prepTimer.recovered = true;'));
});

test('absolute FIRE timestamp does not shift when timer installation is delayed', () => {
  const initialNow = 1_000_000;
  const fireMs = initialNow + 10_000;
  const installedAtMs = initialNow + 3_000;

  assert.equal(new Date(fireMs).getTime(), fireMs);
  assert.equal(finalDelay(fireMs, installedAtMs), 7_000);

  const body = functionBody(agentSource, 'scheduleClaimedJob');
  assert(body.includes('const scheduleAt = new Date(fireMs);'));
  assert(body.includes('scheduledStartAt: scheduleAt.toISOString()'));
  assert(!body.includes('new Date(fireTimerInstalledAtMs + fireDelayMs)'));
});

test('scheduler records persistent lifecycle events for production reconstruction', () => {
  for (const event of [
    'JOB_SEEN',
    'JOB_CLAIMED',
    'JOB_ACCEPTED',
    'PREP_TIMER_CREATED',
    'FIRE_TIMER_CREATED',
    'PREP_TIMER_FIRED',
    'WARMUP_STARTED',
    'BRS_AUTHENTICATED',
    'READY',
    'FIRE_TIMER_FIRED',
    'BRS_NOT_READY_AT_FIRE_TIME',
    'BOOKING_STARTED',
    'DRY_RUN_PREBOOK_REACHED',
    'PROOF_SUCCESS',
    'PROOF_FAILED',
    'BOOKING_SUCCESS',
    'BOOKING_FAILED',
    'MISSED_FIRE_TIME',
  ]) {
    assert(agentSource.includes(`'${event}'`), `${event} event missing`);
  }
});

test('production startup uses only the deterministic PREP/FIRE runner', () => {
  const startup = agentSource.slice(agentSource.indexOf("if (process.env.AGENT_RUN_MAIN === 'true')"));
  assert(startup.includes('startSniperRunner();'));
  assert(!startup.includes('startWarmUpScheduler();'));
});

test('expired pre-fire jobs are explicitly failed instead of waiting forever', () => {
  const body = functionBody(agentSource, 'scheduleClaimedJob');
  assert(body.includes('SNIPER_MISSED_FIRE_GRACE_MS'));
  assert(body.includes("markJobError(jobId, 'MISSED_FIRE_TIME')"));
});

test('firestore job diagnostic exposes project, timer and fire-time evidence', () => {
  for (const field of [
    '/api/firestore/jobs/:jobId/status',
    '/api/firestore/jobs/:jobId/events',
    'firebaseProjectId',
    'runnerInstanceId',
    'computedFireTimeUtc',
    'computedFireTimeLocal',
    'computedPrepTimeUtc',
    'computedPrepTimeLocal',
    'secondsUntilPrep',
    'secondsUntilFire',
    'hasPrepTimer',
    'hasFireTimer',
    'timerDetails',
    'prepTimer',
    'fireTimer',
    'prepTimerInstalledAtUtc',
    'fireTimerInstalledAtUtc',
    'prepTimerInstallLagMs',
    'fireTimerInstallLagMs',
    'brsAuthenticated',
    'lastAgentEvent',
    'lastAgentError',
  ]) {
    assert(agentSource.includes(field), `${field} missing from diagnostics`);
  }
});

test('dashboard does not confirm scheduled sniper without both production timers', () => {
  assert(dashboardSource.includes("data['hasPrepTimer'] != true || data['hasFireTimer'] != true"));
  assert(dashboardSource.includes('Production agent has not registered both PREP and FIRE timers yet.'));
  const statusHelperSource = fs.readFileSync(
    path.join(repoRoot, 'lib/services/sniper_job_status.dart'),
    'utf8',
  );
  assert(statusHelperSource.includes('Arming Sniper…'));
  assert(statusHelperSource.includes('Sniper Scheduled'));
  assert(statusHelperSource.includes('timer_registered'));
});

test('proof fire-time override is restricted to explicit proof dry-run jobs', () => {
  const body = functionBody(agentSource, 'scheduleClaimedJob');
  assert(body.includes('fire-time-override-requires-proof-dry-run'));
  assert(body.includes('isProofDryRunJob'));
});

test('proof dry-run surfaces pre-book boundary and one-click UI action', () => {
  assert(agentSource.includes("'DRY_RUN_PREBOOK_REACHED'"));
  assert(agentSource.includes("'PROOF_SUCCESS'"));
  assert(agentSource.includes("'PROOF_FAILED'"));
  assert(dashboardSource.includes('Run Safe Production Proof'));
  assert(safeProofBuilderSource.includes("'proof_run': true"));
  assert(safeProofBuilderSource.includes("'proof_fire_time_override_utc'"));
  assert(safeProofBuilderSource.includes("'proof_template_job_id'"));
});

test('runtime diagnostics expose effective prep lead', () => {
  assert(agentSource.includes('sniperPrepLeadMs'));
  assert(agentSource.includes('getPrepLeadMs()'));
  assert.equal(agentSource.match(/sniperPrepLeadMs:/g)?.length, 1);
});

test('fire callback captures drift before asynchronous diagnostics', () => {
  const body = functionBody(agentSource, 'scheduleClaimedJob');
  const fireCallback = body.indexOf('const fireNow = async');
  const driftCapture = body.indexOf('const fireCallbackAtMs = Date.now()', fireCallback);
  const firstAwait = body.indexOf('await ', fireCallback);
  assert(driftCapture > fireCallback, 'fire callback timestamp missing');
  assert(driftCapture < firstAwait, 'fire callback timestamp must be captured before await');
});

test('fire hot path does not await diagnostic writes before booking starts', () => {
  const body = functionBody(agentSource, 'scheduleClaimedJob');
  const fireCallback = body.indexOf('const fireNow = async');
  const runBooking = body.indexOf('const result = await runBooking', fireCallback);
  const hotPath = body.slice(fireCallback, runBooking);
  assert(hotPath.includes("void fsAddJobEvent(jobId, 'FIRE_TIMER_FIRED'"));
  assert(hotPath.includes("void fsAddJobEvent(jobId, 'BOOKING_STARTED'"));
  assert(!hotPath.includes("await fsAddJobEvent(jobId, 'FIRE_TIMER_FIRED'"));
  assert(!hotPath.includes("await fsAddJobEvent(jobId, 'BOOKING_STARTED'"));
});

test('scheduled fire path uses nonblocking run-log resolver', () => {
  assert(agentSource.includes("sourcePath !== 'firestore-runner'") === false);
  assert(agentSource.includes('resolveRunLogId'));
  assert(agentSource.includes("sourcePath: 'firestore-runner'"));
});

test('safe availability endpoint returns server-normalized proof candidates with capacity', () => {
  assert(agentSource.includes('partySizeForProof'));
  assert(agentSource.includes('safeProofCandidates'));
  assert(agentSource.includes('filterSafeProofCandidates'));
  assert(agentSource.includes('normalizeSafeAvailabilityFromTeeData'));
});

test('proof success requires reached candidate to match expected proof candidate', () => {
  assert(agentSource.includes('validateProofBoundaryConsistency'));
  assert(agentSource.includes('proof-boundary-proof-candidate-time-mismatch'));
  assert(agentSource.includes('proof-boundary-proof-candidate-tee-mismatch'));
  assert.match(agentSource, /reachedDryRunBoundary =[\s\S]*boundaryConsistency\.ok/);
});

test('numeric member IDs are exact Strategy-0 only', () => {
  assert(agentSource.includes('const isNumericPlayerId = /^\\d+$/.test(playerName);'));
  assert(agentSource.includes("strategy: 'select-by-id'"));
  assert(agentSource.includes('fieldExists: false'));
  assert(agentSource.includes('selectSucceeded: false'));
  assert(agentSource.includes('selectedRequestedValue: false'));
  assert(agentSource.includes('fuzzy fallback disabled'));
  assert.match(agentSource, /if \(!filled\) \{[\s\S]*?fuzzy fallback disabled[\s\S]*?continue;/);
});

test('prebook evidence uses exact verified player IDs', () => {
  assert(agentSource.includes('selectedValueAfterSelect'));
  const boundarySource = fs.readFileSync(path.join(repoRoot, 'agent', 'prebook_boundary.js'), 'utf8');
  assert(boundarySource.includes('playersVerified'));
  assert(boundarySource.includes('exactPlayersVerified'));
  assert(!boundarySource.includes('selectedRequestedValue === undefined'));
  assert(!boundarySource.includes('filled.length >= expected.length'));
});
