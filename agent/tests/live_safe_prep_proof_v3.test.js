import test from 'node:test';
import assert from 'node:assert/strict';

const BASE = 'https://fairwaysniper-production.up.railway.app';
const EXPECTED_SHA = '6c47c2dbf28054365cd4f8ccad65158baacfcd1a';
const PROOF_JOB_ID = 'safe-prep-proof-20260818-v3';
const POLL_MS = 5000;
const DEADLINE_MS = 14 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readJson(path) {
  const response = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(12000) });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text.slice(0, 500) };
  }
  return { httpStatus: response.status, data };
}

function eventTypes(payload) {
  return Array.isArray(payload?.data?.events)
    ? payload.data.events.map((event) => event?.type).filter(Boolean)
    : [];
}

test(
  'deployed v3 safe proof proves PREP is authenticated before FIRE without a booking',
  { timeout: DEADLINE_MS + 60_000 },
  async () => {
    const startedAt = Date.now();
    let exactDeploymentSeen = false;
    let proofSeen = false;
    let status = null;
    let events = null;
    let types = [];

    while (Date.now() - startedAt < DEADLINE_MS) {
      try {
        const version = await readJson('/api/version');
        exactDeploymentSeen =
          version.httpStatus === 200 && version.data?.gitHash === EXPECTED_SHA;

        if (!exactDeploymentSeen) {
          console.log(
            `[SAFE_PROOF_V3] waiting deployment; current=${version.data?.gitHash || version.httpStatus}`,
          );
          await sleep(POLL_MS);
          continue;
        }

        const statusPayload = await readJson(
          `/api/firestore/jobs/${PROOF_JOB_ID}/status`,
        );
        const eventsPayload = await readJson(
          `/api/firestore/jobs/${PROOF_JOB_ID}/events`,
        );

        if (statusPayload.httpStatus === 404) {
          console.log('[SAFE_PROOF_V3] exact deployment live; waiting for proof job creation');
          await sleep(POLL_MS);
          continue;
        }

        proofSeen = statusPayload.httpStatus === 200;
        status = statusPayload.data;
        events = eventsPayload;
        types = eventTypes(eventsPayload);

        console.log(
          '[SAFE_PROOF_V3]',
          JSON.stringify({
            status: status?.status,
            state: status?.state,
            dryRun: status?.dryRun,
            proofRun: status?.proofRun,
            warmState: status?.warmState,
            brsAuthenticated: status?.brsAuthenticated,
            secondsUntilPrep: status?.secondsUntilPrep,
            secondsUntilFire: status?.secondsUntilFire,
            fireTimerDriftMs: status?.fireTimerDriftMs,
            bookingHotPathDeltaMs: status?.bookingHotPathDeltaMs,
            result: status?.result,
            bookedTime: status?.bookedTime,
            lastAgentEvent: status?.lastAgentEvent,
            lastAgentError: status?.lastAgentError,
            events: types.slice(-20),
          }),
        );

        const boundaryReached = [
          'READY',
          'PREFIRE_VERIFY_FIRED',
          'FIRE_TIMER_FIRED',
        ].every((event) => types.includes(event));

        if (boundaryReached) {
          // Allow immediate FIRE-time recovery/error events to be persisted.
          await sleep(12_000);
          const finalStatus = await readJson(
            `/api/firestore/jobs/${PROOF_JOB_ID}/status`,
          );
          const finalEvents = await readJson(
            `/api/firestore/jobs/${PROOF_JOB_ID}/events`,
          );
          status = finalStatus.data;
          events = finalEvents;
          types = eventTypes(finalEvents);
          break;
        }
      } catch (error) {
        console.log(`[SAFE_PROOF_V3] poll error: ${error?.message || String(error)}`);
      }
      await sleep(POLL_MS);
    }

    console.log(
      '[SAFE_PROOF_V3_FINAL]',
      JSON.stringify({
        exactDeploymentSeen,
        proofSeen,
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
        prebookBoundary: status?.prebookBoundary,
        lastAgentEvent: status?.lastAgentEvent,
        lastAgentError: status?.lastAgentError,
        errorMessage: status?.errorMessage,
        events: types,
      }),
    );

    assert.equal(exactDeploymentSeen, true, 'exact v3 production deployment was not observed');
    assert.equal(proofSeen, true, 'deterministic v3 proof job was not created');
    assert.equal(status?.dryRun, true, 'proof lost dryRun safety flag');
    assert.equal(status?.proofRun, true, 'proof lost proofRun safety flag');
    assert.equal(status?.bookedTime ?? null, null, 'safe proof must not create a booking');

    for (const required of ['READY', 'PREFIRE_VERIFY_FIRED', 'FIRE_TIMER_FIRED']) {
      assert(types.includes(required), `missing required event ${required}`);
    }

    const readyIndex = types.indexOf('READY');
    const prefireIndex = types.indexOf('PREFIRE_VERIFY_FIRED');
    const fireIndex = types.indexOf('FIRE_TIMER_FIRED');
    assert(readyIndex < prefireIndex, 'PREP READY must precede T-30 verification');
    assert(prefireIndex < fireIndex, 'T-30 verification must precede FIRE');

    for (const bad of [
      'BRS_NOT_READY_AT_FIRE_TIME',
      'AUTH_FAILED_AT_FIRE',
      'WARMUP_ERROR_AT_FIRE',
    ]) {
      assert.equal(types.includes(bad), false, `unexpected FIRE auth recovery event ${bad}`);
    }

    console.log('SAFE_PREP_PROOF_V3_ACCEPTANCE=PASS');
  },
);
