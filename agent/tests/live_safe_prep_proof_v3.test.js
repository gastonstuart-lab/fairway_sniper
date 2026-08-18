import test from 'node:test';
import assert from 'node:assert/strict';

const BASE = 'https://fairwaysniper-production.up.railway.app';
const EXPECTED_SHA = '6c47c2dbf28054365cd4f8ccad65158baacfcd1a';
const PROOF_JOB_ID = 'safe-prep-proof-20260818-v3';

async function readJson(path) {
  const response = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(12000) });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 1000) }; }
  return { httpStatus: response.status, data };
}

test('diagnose stalled v3 proof timers on deployed runtime', { timeout: 60_000 }, async () => {
  const version = await readJson('/api/version');
  const runtime = await readJson('/api/runtime-status');
  const status = await readJson(`/api/firestore/jobs/${PROOF_JOB_ID}/status`);
  const events = await readJson(`/api/firestore/jobs/${PROOF_JOB_ID}/events`);

  console.log('V3_DIAG_VERSION=' + JSON.stringify(version));
  console.log('V3_DIAG_RUNTIME=' + JSON.stringify(runtime));
  console.log('V3_DIAG_STATUS=' + JSON.stringify(status));
  console.log('V3_DIAG_EVENTS=' + JSON.stringify(events));

  assert.equal(version.httpStatus, 200);
  assert.equal(version.data?.gitHash, EXPECTED_SHA);
  assert.equal(runtime.httpStatus, 200);
  assert.equal(runtime.data?.firebaseAdminReady, true);
  assert.equal(runtime.data?.firestoreConnected, true);
  assert.equal(runtime.data?.sniperRunnerStarted, true);
  assert.equal(status.httpStatus, 200);
  assert.equal(status.data?.dryRun, true);
  assert.equal(status.data?.proofRun, true);
  assert.equal(status.data?.bookedTime ?? null, null);
});
