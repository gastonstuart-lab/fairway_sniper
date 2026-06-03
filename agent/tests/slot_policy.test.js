import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSlotPolicy,
  evaluateSlotCandidate,
  filterAndRankCandidates,
  normalizePreferredTimeLabels,
} from '../slot_policy.js';

test('preferred time unavailable but later slot available is rejected', () => {
  const policy = buildSlotPolicy({
    targetDate: '2026-05-30',
    tee: 1,
    preferredTimes: ['11:04', '11:12', '11:20'],
    partySize: 4,
  });

  const result = evaluateSlotCandidate(policy, {
    date: '2026-05-30',
    tee: 1,
    time: '16:36',
    openSlots: 4,
  });

  assert.equal(result.accepted, false);
  assert.deepEqual(result.reasons, ['wrong-time']);
});

test('10th tee selected accepts only 10th tee candidates', () => {
  const policy = buildSlotPolicy({
    targetDate: '2026-05-30',
    tee: 10,
    preferredTimes: ['11:04'],
    partySize: 1,
  });

  assert.equal(evaluateSlotCandidate(policy, {
    date: '2026-05-30',
    tee: 10,
    time: '11:04',
  }).accepted, true);

  const wrongTee = evaluateSlotCandidate(policy, {
    date: '2026-05-30',
    tee: 1,
    time: '11:04',
  });

  assert.equal(wrongTee.accepted, false);
  assert.deepEqual(wrongTee.reasons, ['wrong-tee']);
});

test('preferredTimes order is preserved when ranking accepted candidates', () => {
  const policy = buildSlotPolicy({
    targetDate: '2026-05-30',
    tee: 1,
    preferredTimes: ['11:20', '11:04', '11:12'],
    partySize: 1,
  });

  const { accepted } = filterAndRankCandidates(policy, [
    { date: '2026-05-30', tee: 1, time: '11:04' },
    { date: '2026-05-30', tee: 1, time: '11:12' },
    { date: '2026-05-30', tee: 1, time: '11:20' },
  ]);

  assert.deepEqual(accepted.map((candidate) => candidate.evaluation.selectedTime), [
    '11:20',
    '11:04',
    '11:12',
  ]);
});

test('missing tee is handled clearly', () => {
  const policy = buildSlotPolicy({
    targetDate: '2026-05-30',
    tee: null,
    preferredTimes: ['11:04'],
    partySize: 1,
  });

  const result = evaluateSlotCandidate(policy, {
    date: '2026-05-30',
    tee: 1,
    time: '11:04',
  });

  assert.equal(result.accepted, false);
  assert.deepEqual(result.reasons, ['missing-requested-tee']);
});

test('exact matching slot is accepted', () => {
  const policy = buildSlotPolicy({
    targetDate: '2026-05-30',
    tee: 1,
    preferredTimes: ['11:04'],
    partySize: 4,
  });

  const result = evaluateSlotCandidate(policy, {
    date: '2026-05-30',
    tee: 1,
    time: '11:04',
    openSlots: 4,
  });

  assert.equal(result.accepted, true);
  assert.deepEqual(result.reasons, []);
});

test('wrong date and wrong time are rejected', () => {
  const policy = buildSlotPolicy({
    targetDate: '2026-05-30',
    tee: 1,
    preferredTimes: ['11:04'],
    partySize: 1,
  });

  const result = evaluateSlotCandidate(policy, {
    date: '2026-05-31',
    tee: 1,
    time: '16:36',
  });

  assert.equal(result.accepted, false);
  assert.deepEqual(result.reasons, ['wrong-date', 'wrong-time']);
});

test('multi-player capacity must be proven', () => {
  const policy = buildSlotPolicy({
    targetDate: '2026-05-30',
    tee: 1,
    preferredTimes: ['11:04'],
    partySize: 4,
  });

  const result = evaluateSlotCandidate(policy, {
    date: '2026-05-30',
    tee: 1,
    time: '11:04',
  });

  assert.equal(result.accepted, false);
  assert.deepEqual(result.reasons, ['capacity-unproven']);
});

test('preferred time normalization dedupes without reordering', () => {
  assert.deepEqual(normalizePreferredTimeLabels(['11:04', '1104', '11:12']), [
    '11:04',
    '11:12',
  ]);
});
