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
  const warmStart = body.indexOf("fsAddJobEvent(jobId, 'WARMUP_STARTED'");
  assert(prepTimerCreate > -1, 'prep timer event missing');
  assert(fireTimerCreate > -1, 'fire timer event missing');
  assert(timerSet > -1, 'timer registration missing');
  assert(warmStart > -1, 'warm-up event missing');
  assert(prepTimerCreate < warmStart, 'prep timer must be registered before warm-up starts');
  assert(fireTimerCreate < warmStart, 'fire timer must be registered before warm-up starts');
  assert(timerSet < warmStart, 'timer must be registered before warm-up starts');
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
    'brsAuthenticated',
    'lastAgentEvent',
    'lastAgentError',
  ]) {
    assert(agentSource.includes(field), `${field} missing from diagnostics`);
  }
});

test('dashboard does not confirm armed sniper without both production timers', () => {
  assert(dashboardSource.includes("data['hasPrepTimer'] != true || data['hasFireTimer'] != true"));
  assert(dashboardSource.includes('Production agent has not registered both PREP and FIRE timers yet.'));
  assert(dashboardSource.includes('Waiting for Production'));
  assert(dashboardSource.includes('timer_registered'));
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
  assert(dashboardSource.includes("'proof_run': true"));
  assert(dashboardSource.includes("'proof_fire_time_override_utc'"));
});
