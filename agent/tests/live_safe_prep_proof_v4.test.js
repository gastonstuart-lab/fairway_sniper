import test from 'node:test';
import assert from 'node:assert/strict';

const BASE = 'https://fairwaysniper-production.up.railway.app';
const EXPECTED_SHA = '0ccf0bb69f56e55cac5dd5260cdbfd49ee097db6';
const PROOF_JOB_ID = 'safe-prep-proof-20260818-v4';
const POLL_MS = 5000;
const DEADLINE_MS = 14 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readJson(path) {
  const response = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(12000) });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 1000) }; }
  return { httpStatus: response.status, data };
}

function eventTypes(payload) {
  return Array.isArray(payload?.data?.events)
    ? payload.data.events.map((event) => event?.type).filter(Boolean)
    : [];
}

test(
  'v4 proves prepared BRS session survives PREP and T-30 into FIRE with no live booking',
  { timeout: DEADLINE_MS + 60_000 },
  async () => {
    const startedAt = Date.now();
    let deploymentSeen = false;
    let proofSeen = false;
    let status = null;
    let eventsPayload = null;
    let types = [];

    while (Date.now() - startedAt < DEADLINE_MS) {
      try {
        const version = await readJson('/api/version');
        deploymentSeen = version.httpStatus === 200 && version.data?.gitHash === EXPECTED_SHA;
        if (!deploymentSeen) {
          console.log(`[SAFE_PROOF_V4] waiting deployment current=${version.data?.gitHash || version.httpStatus}`);
          await sleep(POLL_MS);
          continue;
        }

        const statusPayload = await readJson(`/api/firestore/jobs/${PROOF_JOB_ID}/status`);
        if (statusPayload.httpStatus === 404) {
          console.log('[SAFE_PROOF_V4] deployment stable; waiting delayed proof creation');
          await sleep(POLL_MS);
          continue;
        }

        proofSeen = statusPayload.httpStatus === 200;
        status = statusPayload.data;
        eventsPayload = await readJson(`/api/firestore/jobs/${PROOF_JOB_ID}/events`);
        types = eventTypes(eventsPayload);

        console.log('[SAFE_PROOF_V4]', JSON.stringify({
          runnerInstanceId: status?.runnerInstanceId,
          claimedBy: status?.claimedBy,
          hasTimer: status?.hasTimer,
          hasPrepTimer: status?.hasPrepTimer,
          hasFireTimer: status?.hasFireTimer,
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
          firstBrsActionDeltaMs: status?.firstBrsActionDeltaMs,
          result: status?.result,
          bookedTime: status?.bookedTime,
          lastAgentEvent: status?.lastAgentEvent,
          lastAgentError: status?.lastAgentError,
          events: types.slice(-25),
        }));

        const boundaryReached = ['READY', 'PREFIRE_VERIFY_FIRED', 'FIRE_TIMER_FIRED']
          .every((name) => types.includes(name));
        if (boundaryReached) {
          await sleep(12_000);
          const finalStatus = await readJson(`/api/firestore/jobs/${PROOF_JOB_ID}/status`);
          const finalEvents = await readJson(`/api/firestore/jobs/${PROOF_JOB_ID}/events`);
          status = finalStatus.data;
          eventsPayload = finalEvents;
          types = eventTypes(finalEvents);
          break;
        }
      } catch (error) {
        console.log(`[SAFE_PROOF_V4] poll error: ${error?.message || String(error)}`);
      }
      await sleep(POLL_MS);
    }

    console.log('[SAFE_PROOF_V4_FINAL]', JSON.stringify({
      deploymentSeen,
      proofSeen,
      runnerInstanceId: status?.runnerInstanceId,
      claimedBy: status?.claimedBy,
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
    }));

    assert.equal(deploymentSeen, true, 'exact v4 production deployment was not observed');
    assert.equal(proofSeen, true, 'v4 proof job was not created');
    assert.equal(status?.dryRun, true, 'proof lost dryRun safety flag');
    assert.equal(status?.proofRun, true, 'proof lost proofRun safety flag');
    assert.equal(status?.bookedTime ?? null, null, 'safe proof must not create a booking');

    for (const required of ['PREP_TIMER_FIRED', 'WARMUP_STARTED', 'BRS_AUTHENTICATED', 'READY', 'PREFIRE_VERIFY_FIRED', 'FIRE_TIMER_FIRED']) {
      assert(types.includes(required), `missing required lifecycle event ${required}`);
    }

    const readyIndex = types.indexOf('READY');
    const verifyIndex = types.indexOf('PREFIRE_VERIFY_FIRED');
    const fireIndex = types.indexOf('FIRE_TIMER_FIRED');
    assert(readyIndex < verifyIndex, 'READY must precede pre-fire verification');
    assert(verifyIndex < fireIndex, 'pre-fire verification must precede FIRE');

    const badFireEvents = ['BRS_NOT_READY_AT_FIRE_TIME', 'AUTH_FAILED_AT_FIRE', 'WARMUP_ERROR_AT_FIRE'];
    for (const bad of badFireEvents) {
      assert.equal(types.includes(bad), false, `unexpected FIRE auth recovery event ${bad}`);
    }

    assert.equal(status?.claimedBy, status?.runnerInstanceId, 'proof timer owner must be the surviving runtime instance');
    console.log('SAFE_PREP_PROOF_V4_ACCEPTANCE=PASS');
  },
);
