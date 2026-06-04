import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSlotPolicy,
  evaluateSlotCandidate,
} from '../slot_policy.js';
import {
  countOpenParticipantSlots,
  getEntryOpenSlots,
} from '../tee_data_policy.js';

test('empty participants means the full four-ball is open', () => {
  assert.equal(countOpenParticipantSlots([]), 4);
  assert.equal(getEntryOpenSlots({ tee_time: { participants: [] } }), 4);
});

test('partial participant list means remaining four-ball capacity', () => {
  assert.equal(
    getEntryOpenSlots({
      tee_time: {
        participants: [
          { name: 'Existing Player One' },
          { name: 'Existing Player Two' },
        ],
      },
    }),
    2,
  );
});

test('empty participant placeholders are counted as open slots', () => {
  assert.equal(
    getEntryOpenSlots({
      tee_time: {
        participants: [
          { name: 'Existing Player' },
          { name: '' },
          { name: null },
          {},
        ],
      },
    }),
    3,
  );
});

test('explicit open slot field overrides participant inference', () => {
  assert.equal(
    getEntryOpenSlots({
      tee_time: {
        open_slots: 1,
        participants: [],
      },
    }),
    1,
  );
});

test('empty BRS participant list allows exact four-player sniper candidate', () => {
  const entry = {
    tee_time: {
      url: '/galgorm/bookings/book/token/1/20260609/1100',
      participants: [],
      bookable: true,
    },
  };
  const policy = buildSlotPolicy({
    targetDate: '2026-06-09',
    tee: 1,
    preferredTimes: ['11:00', '11:10', '11:20'],
    partySize: 4,
  });

  const result = evaluateSlotCandidate(policy, {
    date: '2026-06-09',
    tee: 1,
    time: '11:00',
    href: entry.tee_time.url,
    openSlots: getEntryOpenSlots(entry),
  });

  assert.equal(result.accepted, true);
  assert.equal(result.openSlots, 4);
  assert.deepEqual(result.reasons, []);
});
