import test from 'node:test';
import assert from 'node:assert/strict';

const BASE = 'https://fairwaysniper-production.up.railway.app';
const EXPECTED_SHA = 'a98ddd305765efd3b60f8f764301ec48d703b985';
const SOURCE_JOB_ID = 'IOjhrgHbPR5ZttcgyUXz';
const PROOF_JOB_ID = 'safe-prep-proof-20260818-v2';

async function readJson(path) {
  const response = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(12000) });
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }
  return { httpStatus: response.status, data };
}

test('diagnose deployed safe proof bootstrap', { timeout: 60_000 }, async () => {
  const version = await readJson('/api/version');
  const runtime = await readJson('/api/runtime-status');
  const source = await readJson(`/api/firestore/jobs/${SOURCE_JOB_ID}/status`);
  const sourceEvents = await readJson(`/api/firestore/jobs/${SOURCE_JOB_ID}/events`);
  const proof = await readJson(`/api/firestore/jobs/${PROOF_JOB_ID}/status`);
  const proofEvents = await readJson(`/api/firestore/jobs/${PROOF_JOB_ID}/events`);

  const summarizeEvents = (payload) =>
    Array.isArray(payload?.data?.events)
      ? payload.data.events.map((event) => event?.type).filter(Boolean).slice(-25)
      : [];

  console.log('SAFE_PROOF_DIAG_VERSION=' + JSON.stringify(version));
  console.log('SAFE_PROOF_DIAG_RUNTIME=' + JSON.stringify({
    httpStatus: runtime.httpStatus,
    deployment: runtime.data?.deployment,
    firebaseAdminReady: runtime.data?.firebaseAdminReady,
    firebaseAdminError: runtime.data?.firebaseAdminError,
    firebaseProjectId: runtime.data?.firebaseProjectId,
    firestoreConnected: runtime.data?.firestoreConnected,
    agentRunMain: runtime.data?.agentRunMain,
    sniperRunnerStarted: runtime.data?.sniperRunnerStarted,
    timers: runtime.data?.timers,
    brsBrowserStatus: runtime.data?.brsBrowserStatus,
    lastRunnerEvent: runtime.data?.lastRunnerEvent,
    lastRunnerError: runtime.data?.lastRunnerError,
  }));
  console.log('SAFE_PROOF_DIAG_SOURCE=' + JSON.stringify({
    httpStatus: source.httpStatus,
    data: source.data,
    events: summarizeEvents(sourceEvents),
  }));
  console.log('SAFE_PROOF_DIAG_PROOF=' + JSON.stringify({
    httpStatus: proof.httpStatus,
    data: proof.data,
    events: summarizeEvents(proofEvents),
  }));

  assert.equal(version.httpStatus, 200);
  assert.equal(version.data?.gitHash, EXPECTED_SHA);
  assert.equal(runtime.data?.firebaseAdminReady, true);
  assert.equal(runtime.data?.firestoreConnected, true);
  assert.equal(runtime.data?.sniperRunnerStarted, true);
  // This diagnostic intentionally passes even when the proof is absent; the
  // printed evidence tells us which bootstrap precondition failed.
});
