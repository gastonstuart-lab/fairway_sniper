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

test('scheduler registers release timer before BRS warm-up can block', () => {
  const body = functionBody(agentSource, 'scheduleClaimedJob');
  const timerSet = body.indexOf('jobTimers.set(jobId');
  const warmStart = body.indexOf("fsAddJobEvent(jobId, 'WARMUP_STARTED'");
  assert(timerSet > -1, 'timer registration missing');
  assert(warmStart > -1, 'warm-up event missing');
  assert(timerSet < warmStart, 'timer must be registered before warm-up starts');
});

test('scheduler records persistent lifecycle events for production reconstruction', () => {
  for (const event of [
    'JOB_SEEN',
    'JOB_CLAIMED',
    'JOB_ACCEPTED',
    'TIMER_CREATED',
    'WARMUP_STARTED',
    'BRS_AUTHENTICATED',
    'READY',
    'TIMER_FIRED',
    'BOOKING_STARTED',
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
    'secondsUntilFire',
    'hasTimer',
    'timerDetails',
    'brsAuthenticated',
    'lastAgentEvent',
    'lastAgentError',
  ]) {
    assert(agentSource.includes(field), `${field} missing from diagnostics`);
  }
});

test('dashboard does not confirm armed sniper without production timer', () => {
  assert(dashboardSource.includes("data['hasTimer'] != true"));
  assert(dashboardSource.includes('Production agent has not registered a release timer yet.'));
  assert(dashboardSource.includes('Waiting for Production'));
  assert(dashboardSource.includes('timer_registered'));
});
