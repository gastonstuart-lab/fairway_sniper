import test from 'node:test';
import assert from 'node:assert/strict';

const BASE = 'https://fairwaysniper-production.up.railway.app';
const EXPECTED_SHA = 'a98ddd305765efd3b60f8f764301ec48d703b985';
const PROOF_JOB_ID = 'safe-prep-proof-20260818-v2';
const POLL_MS = 5000;
const DEADLINE_MS = 12 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) return { httpStatus: response.status };
  return response.json();
}

function eventTypes(payload) {
  return Array.isArray(payload?.events)
    ? payload.events.map((event) => event?.type).filter(Boolean)
    : [];
}

test(
  'deployed repaired runtime keeps the safe proof authenticated through FIRE',
  { timeout: DEADLINE_MS + 60_000 },
  async () => {
    const startedAt = Date.now();
    let deployedSeen = false;
    let status = null;
    let events = null;
    let types = [];

    while (Date.now() - startedAt < DEADLINE_MS) {
      try {
        const version = await readJson(`${BASE}/api/version`);
        deployedSeen = version?.gitHash === EXPECTED_SHA;
        console.log(
          `[SAFE_PROOF_MONITOR] deployment=${version?.gitHash || version?.httpStatus || 'unavailable'} expected=${EXPECTED_SHA}`,
        );
        if (!deployedSeen) {
          await sleep(POLL_MS);
          continue;
        }

        status = await readJson(
          `${BASE}/api/firestore/jobs/${PROOF_JOB_ID}/status`,
        );
        events = await readJson(
          `${BASE}/api/firestore/jobs/${PROOF_JOB_ID}/events`,
        );
        types = eventTypes(events);

        console.log(
          '[SAFE_PROOF_MONITOR]',
          JSON.stringify({
            httpStatus: status?.httpStatus || 200,
            status: status?.status,
            state: status?.state,
            dryRun: status?.dryRun,
            proofRun: status?.proofRun,
            warmState: status?.warmState,
            brsAuthenticated: status?.brsAuthenticated,
            secondsUntilPrep: status?.secondsUntilPrep,
            secondsUntilFire: status?.secondsUntilFire,
            lastAgentEvent: status?.lastAgentEvent,
            lastAgentError: status?.lastAgentError,
            bookedTime: status?.bookedTime,
            events: types.slice(-20),
          }),
        );

        const boundaryReached = [
          'READY',
          'PREFIRE_VERIFY_FIRED',
          'FIRE_TIMER_FIRED',
        ].every((name) => types.includes(name));

        if (boundaryReached) {
          // Give the FIRE callback time to emit an immediate recovery/error signal.
          await sleep(10_000);
          status = await readJson(
            `${BASE}/api/firestore/jobs/${PROOF_JOB_ID}/status`,
          );
          events = await readJson(
            `${BASE}/api/firestore/jobs/${PROOF_JOB_ID}/events`,
          );
          types = eventTypes(events);
          break;
        }
      } catch (error) {
        console.log(`[SAFE_PROOF_MONITOR] poll error: ${error?.message || error}`);
      }
      await sleep(POLL_MS);
    }

    console.log(
      '[SAFE_PROOF_FINAL]',
      JSON.stringify({
        deployedSeen,
        status: status?.status,
        state: status?.state,
        dryRun: status?.dryRun,
        proofRun: status?.proofRun,
        warmState: status?.warmState,
        brsAuthenticated: status?.brsAuthenticated,
        fireTimerDriftMs: status?.fireTimerDriftMs,
        bookingHotPathDeltaMs: status?.bookingHotPathDeltaMs,
        firstBrsActionDeltaMs: status?.firstBrsActionDeltaMs,
        result: status?.result,
        bookedTime: status?.bookedTime,
        lastAgentEvent: status?.lastAgentEvent,
        lastAgentError: status?.lastAgentError,
        errorMessage: status?.errorMessage,
        events: types,
      }),
    );

    assert.equal(deployedSeen, true, 'exact repaired Railway deployment was not observed');
    assert.equal(status?.dryRun, true, 'proof lost dryRun safety flag');
    assert.equal(status?.proofRun, true, 'proof lost proofRun safety flag');
    assert.equal(status?.bookedTime ?? null, null, 'safe proof must not create a booking');

    for (const required of ['READY', 'PREFIRE_VERIFY_FIRED', 'FIRE_TIMER_FIRED']) {
      assert(types.includes(required), `missing required lifecycle event ${required}`);
    }

    const readyIndex = types.indexOf('READY');
    const prefireIndex = types.indexOf('PREFIRE_VERIFY_FIRED');
    const fireIndex = types.indexOf('FIRE_TIMER_FIRED');
    assert(readyIndex < prefireIndex, 'READY must occur before pre-fire verification');
    assert(prefireIndex < fireIndex, 'pre-fire verification must occur before FIRE');

    for (const bad of [
      'BRS_NOT_READY_AT_FIRE_TIME',
      'AUTH_FAILED_AT_FIRE',
      'WARMUP_ERROR_AT_FIRE',
    ]) {
      assert.equal(types.includes(bad), false, `unexpected FIRE auth recovery signal ${bad}`);
    }

    console.log('SAFE_PREP_PROOF_ACCEPTANCE=PASS');
  },
);
