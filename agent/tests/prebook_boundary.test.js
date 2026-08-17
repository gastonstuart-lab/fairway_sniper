import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  DRY_RUN_PREBOOK_REACHED,
  buildPrebookBoundaryEvidence,
  validatePrebookBoundary,
} from '../prebook_boundary.js';
import { validatePartyPlayers } from '../party_validation.js';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const agentSource = fs.readFileSync(path.join(repoRoot, 'agent', 'index.js'), 'utf8');

function fakePage({
  formVisible = true,
  confirmVisible = true,
  confirmEnabled = true,
  globalBookVisible = false,
  confirmText = 'Create Booking',
  url = 'https://members.brsgolf.com/galgorm/bookings/book/1112',
  onClick = () => {},
} = {}) {
  const confirmControl = {
    first() {
      return this;
    },
    async isVisible() {
      return confirmVisible;
    },
    async isEnabled() {
      return confirmEnabled;
    },
    async textContent() {
      return confirmText;
    },
    async evaluate() {
      return confirmEnabled;
    },
    async click() {
      onClick();
    },
  };
  const form = {
    first() {
      return this;
    },
    async isVisible() {
      return formVisible;
    },
    locator() {
      return confirmControl;
    },
  };
  const globalButton = {
    first() {
      return this;
    },
    async isVisible() {
      return globalBookVisible;
    },
  };
  return {
    url: () => url,
    locator: (selector) => {
      if (selector === 'form[name="member_booking_form"]') return form;
      return globalButton;
    },
  };
}

test('valid dry-run form with enabled confirm reaches pre-book boundary', async () => {
  const boundary = await validatePrebookBoundary(fakePage(), {
    players: ['42'],
    openSlots: 2,
    confirmResult: { filled: ['42'] },
    candidateTime: '11:12',
    teeSelected: '1ST TEE',
  });

  assert.equal(boundary.prebookBoundaryReached, true);
  assert.equal(boundary.result, DRY_RUN_PREBOOK_REACHED);
  assert.equal(boundary.bookingFormVisible, true);
  assert.equal(boundary.confirmControlVisible, true);
  assert.equal(boundary.confirmControlEnabled, true);
  assert.equal(boundary.finalControlNotClicked, true);
});

test('dry-run pre-book validation never clicks the final booking control', async () => {
  let clicked = false;
  await validatePrebookBoundary(fakePage({ onClick: () => { clicked = true; } }), {
    players: [],
    openSlots: 1,
    confirmResult: { filled: [] },
  });

  assert.equal(clicked, false);
});

test('missing confirm control fails the proof boundary', async () => {
  const boundary = await validatePrebookBoundary(fakePage({ confirmVisible: false }), {
    players: [],
    openSlots: 1,
    confirmResult: { filled: [] },
  });

  assert.equal(boundary.prebookBoundaryReached, false);
  assert.equal(boundary.error, 'confirm-control-not-found');
});

test('disabled confirm control fails the proof boundary', async () => {
  const boundary = await validatePrebookBoundary(fakePage({ confirmEnabled: false }), {
    players: [],
    openSlots: 1,
    confirmResult: { filled: [] },
  });

  assert.equal(boundary.prebookBoundaryReached, false);
  assert.equal(boundary.error, 'confirm-control-disabled');
});

test('missing required player fails the proof boundary', () => {
  const boundary = buildPrebookBoundaryEvidence({
    bookingFormVisible: true,
    confirmControlVisible: true,
    confirmControlEnabled: true,
    playersExpected: ['42'],
    playersFilled: [],
    capacityValidated: true,
  });

  assert.equal(boundary.prebookBoundaryReached, false);
  assert.equal(boundary.error, 'players-missing-before-confirm');
});

test('insufficient capacity fails the proof boundary', () => {
  const boundary = buildPrebookBoundaryEvidence({
    bookingFormVisible: true,
    confirmControlVisible: true,
    confirmControlEnabled: true,
    playersExpected: ['42', '84'],
    playersFilled: ['42', '84'],
    capacityValidated: false,
  });

  assert.equal(boundary.prebookBoundaryReached, false);
  assert.equal(boundary.error, 'insufficient-capacity');
});

test('global Book button outside member booking form is rejected', async () => {
  const boundary = await validatePrebookBoundary(
    fakePage({ formVisible: false, globalBookVisible: true }),
    {
      players: [],
      openSlots: 1,
      confirmResult: { filled: [] },
    },
  );

  assert.equal(boundary.prebookBoundaryReached, false);
  assert.equal(boundary.error, 'booking-form-not-found');
});

test('four-player party requires exactly three distinct player IDs', () => {
  assert.equal(
    validatePartyPlayers({ partySize: 4, players: ['1', '2', '3'] }).ok,
    true,
  );
  assert.equal(
    validatePartyPlayers({ partySize: 4, players: ['1', '2'] }).error,
    'party-player-count-mismatch',
  );
  assert.equal(
    validatePartyPlayers({ partySize: 4, players: ['1', '1', '3'] }).error,
    'duplicate-player-id',
  );
  assert.equal(
    validatePartyPlayers({ partySize: 5, players: ['1', '2', '3', '4'] }).error,
    'invalid-party-size',
  );
});

test('live booking behavior still clicks confirm outside dry-run branch', () => {
  assert.match(agentSource, /if \(dryRun\) \{[\s\S]*?validatePrebookBoundary[\s\S]*?return result;\s*\}\s*[\s\S]*?confirmBtn\.click/);
});

test('all dry-run booking routes use shared pre-book boundary semantics', () => {
  assert(!agentSource.includes('dry-run-no-confirm'));
  assert(agentSource.includes('validatePrebookBoundary'));
  assert.match(agentSource, /tryDirectBookingHref[\s\S]*?prebookBoundaryReached/);
  assert.match(agentSource, /executeReleaseBooking[\s\S]*?prebookBoundaryReached/);
  assert.match(agentSource, /runPreferredTimesLoop[\s\S]*?prebookBoundaryReached/);
});

test('failed proof cannot emit BOOKING_SUCCESS', () => {
  assert.match(agentSource, /const reachedDryRunBoundary = result\?\.result === 'DRY_RUN_PREBOOK_REACHED'/);
  assert.match(agentSource, /fsAddJobEvent\(jobId, reachedDryRunBoundary \? 'PROOF_SUCCESS' : 'PROOF_FAILED'/);
  assert.match(agentSource, /isSuccess \? 'BOOKING_SUCCESS' : 'BOOKING_FAILED'/);
});

test('successful proof emits dry-run boundary and proof success events', () => {
  assert(agentSource.includes("'DRY_RUN_PREBOOK_REACHED'"));
  assert(agentSource.includes("'PROOF_SUCCESS'"));
  assert(agentSource.includes('result: DRY_RUN_PREBOOK_REACHED'));
});
