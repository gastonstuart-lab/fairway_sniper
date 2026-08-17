import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const testDir = path.dirname(__filename);
const agentDir = path.dirname(testDir);
const runnerPath = path.join(agentDir, 'production_server_v2.js');
const warmPath = path.join(agentDir, 'warm_session.js');
const packagePath = path.join(agentDir, 'package.json');

const runner = fs.readFileSync(runnerPath, 'utf8');
const warm = fs.readFileSync(warmPath, 'utf8');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

test('production start command uses v2 runner', () => {
  assert.equal(pkg.scripts.start, 'node production_server_v2.js');
  assert.equal(pkg.main, 'production_server_v2.js');
});

test('v2 registers independent PREP and FIRE timers before prep work', () => {
  assert.match(runner, /PREP_TIMER_CREATED/);
  assert.match(runner, /FIRE_TIMER_CREATED/);
  assert.match(runner, /PREP_TIMER_FIRED/);
  assert.match(runner, /FIRE_TIMER_FIRED/);
  assert.match(runner, /entry\.prepHandle\s*=\s*scheduleLongTimeout/);
  assert.match(runner, /entry\.fireHandle\s*=\s*scheduleLongTimeout/);

  const prepTimerIndex = runner.indexOf('entry.prepHandle = scheduleLongTimeout');
  const fireTimerIndex = runner.indexOf('entry.fireHandle = scheduleLongTimeout');
  const immediatePrepIndex = runner.indexOf('if (prepTime.getTime() <= now)');
  assert.ok(prepTimerIndex >= 0);
  assert.ok(fireTimerIndex > prepTimerIndex);
  assert.ok(immediatePrepIndex > fireTimerIndex);
});

test('live jobs cannot use arbitrary proof fire-time override', () => {
  const proofGuard = runner.indexOf('if (isProofJob(job))');
  const proofOverride = runner.indexOf('job.proof_fire_time_utc');
  const normalRelease = runner.indexOf('computeReleaseFireUTCForTargetDate');
  assert.ok(proofGuard >= 0);
  assert.ok(proofOverride > proofGuard);
  assert.ok(normalRelease > proofOverride);
  assert.match(runner, /job\?\.proof_test === true && job\?\.dry_run === true/);
});

test('fire is idempotently claimed before booking execution', () => {
  assert.match(runner, /async function acquireFireLease/);
  assert.match(runner, /if \(data\.booking_started_at \|\| data\.fire_claimed_at\) return null/);
  const leaseIndex = runner.indexOf('const leaseJob = await acquireFireLease(jobId)');
  const bookingIndex = runner.indexOf('const result = await runBooking(');
  assert.ok(leaseIndex >= 0);
  assert.ok(bookingIndex > leaseIndex);
});

test('proof path is dry-run and requires pre-book boundary before success', () => {
  assert.match(runner, /dryRun: proof \|\| job\.dry_run === true/);
  assert.match(runner, /DRY_RUN_PREBOOK_REACHED/);
  assert.match(runner, /PROOF_SUCCESS/);
  assert.match(runner, /result\?\.result === 'dry_run'/);
  assert.match(runner, /booked_time: null/);
});

test('public live helper endpoints are blocked by v2 front door', () => {
  assert.match(runner, /\/api\/release-snipe/);
  assert.match(runner, /\/api\/sniper-test/);
  assert.match(runner, /\/api\/snipe/);
  assert.match(runner, /Public booking endpoints are disabled/);
});

test('warm session is a real reusable Chromium session, not the disabled stub', () => {
  assert.match(warm, /chromium\.launch\(/);
  assert.match(warm, /warmBrowser = await chromium\.launch/);
  assert.match(warm, /export async function getWarmPage/);
  assert.match(warm, /return await inflightInit/);
  assert.doesNotMatch(warm, /warm session disabled - caller should create regular session/);
  assert.doesNotMatch(warm, /DISABLED: Return null/);
});

test('diagnostics prove both timers and production confirmation', () => {
  assert.match(runner, /hasPrepTimer/);
  assert.match(runner, /hasFireTimer/);
  assert.match(runner, /productionConfirmed/);
  assert.match(runner, /computedPrepTimeUtc/);
  assert.match(runner, /computedFireTimeUtc/);
  assert.match(runner, /secondsUntilPrep/);
  assert.match(runner, /secondsUntilFire/);
});
