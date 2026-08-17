import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveRunLogId } from '../run_log_timing.js';

test('delayed fsAddRun cannot delay scheduled FIRE path', async () => {
  let createRunStarted = false;
  let releaseCreateRun;
  const delayedRun = new Promise((resolve) => {
    releaseCreateRun = () => resolve('late-run-id');
  });

  const startedAt = Date.now();
  const runId = await resolveRunLogId({
    sourcePath: 'firestore-runner',
    createRun: () => {
      createRunStarted = true;
      return delayedRun;
    },
  });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(runId, null);
  assert(elapsedMs < 50, `scheduled FIRE waited ${elapsedMs}ms for run log creation`);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(createRunStarted, true);
  releaseCreateRun();
});

test('non-scheduled paths still await a run log id', async () => {
  const runId = await resolveRunLogId({
    sourcePath: 'endpoint:/api/book-now',
    createRun: async () => 'run-id',
  });

  assert.equal(runId, 'run-id');
});
