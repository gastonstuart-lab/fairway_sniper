import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterSafeProofCandidates,
  normalizeSafeAvailabilityFromTeeData,
} from '../safe_availability.js';

const date = '2026-08-22';

function slot({
  time,
  openSlots,
  bookable = true,
  href = `/galgorm/bookings/book/token/1/20260822/${time.replace(':', '')}`,
  participants,
} = {}) {
  const teeTime = {
    bookable,
    url: href,
  };
  if (openSlots !== undefined) teeTime.open_slots = openSlots;
  if (participants !== undefined) teeTime.participants = participants;
  return { tee_time: teeTime };
}

test('actual safe-availability response contains proven openSlots from BRS tee data', () => {
  const slots = normalizeSafeAvailabilityFromTeeData(
    {
      times: {
        '11:12': slot({ time: '11:12', participants: [] }),
      },
    },
    { date, tee: 1, includeUnavailable: false },
  );

  assert.deepEqual(slots, [
    {
      date,
      time: '11:12',
      tee: 1,
      state: 'bookable',
      bookable: true,
      href: 'https://members.brsgolf.com/galgorm/bookings/book/token/1/20260822/1112',
      openSlots: 4,
      editable: null,
      source: 'brs-tee-data',
    },
  ]);
});

test('bookable state and href are required for proof candidates', () => {
  const slots = normalizeSafeAvailabilityFromTeeData(
    {
      times: {
        '11:12': slot({ time: '11:12', bookable: true, href: null, openSlots: 4 }),
        '11:20': slot({ time: '11:20', bookable: true, openSlots: 4 }),
      },
    },
    { date, tee: 1, includeUnavailable: true },
  );

  assert.deepEqual(filterSafeProofCandidates(slots, { partySize: 4 }).map((s) => s.time), [
    '11:20',
  ]);
});

test('includeUnavailable=false excludes unavailable and unknown slots', () => {
  const slots = normalizeSafeAvailabilityFromTeeData(
    {
      times: {
        '11:12': slot({ time: '11:12', openSlots: 4 }),
        '11:20': slot({ time: '11:20', bookable: false, openSlots: 4 }),
        '11:28': { tee_time: { url: '/galgorm/bookings/book/token/1/20260822/1128' } },
      },
    },
    { date, tee: 1, includeUnavailable: false },
  );

  assert.deepEqual(slots.map((s) => s.time), ['11:12']);
});

test('four-player proof candidate capacity requires four known open slots', () => {
  const slots = normalizeSafeAvailabilityFromTeeData(
    {
      times: {
        '11:12': slot({ time: '11:12', openSlots: 4 }),
        '11:20': slot({ time: '11:20', openSlots: 3 }),
        '11:28': { tee_time: { bookable: true, url: '/galgorm/bookings/book/token/1/20260822/1128' } },
      },
    },
    { date, tee: 1, includeUnavailable: false },
  );

  assert.deepEqual(filterSafeProofCandidates(slots, { partySize: 4 }).map((s) => s.time), [
    '11:12',
  ]);
});
