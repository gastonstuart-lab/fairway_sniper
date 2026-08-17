import { getEntryOpenSlots } from './tee_data_policy.js';

function normalizeTimeLabel(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return null;
  const hhmm = digits.padStart(4, '0').slice(-4);
  const hour = Number.parseInt(hhmm.slice(0, 2), 10);
  const minute = Number.parseInt(hhmm.slice(2), 10);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  if (hour < 0 || hour > 23 || minute > 59) return null;
  return `${hhmm.slice(0, 2)}:${hhmm.slice(2)}`;
}

function normalizeHref(value) {
  if (!value) return null;
  try {
    return new URL(String(value), 'https://members.brsgolf.com').href;
  } catch {
    return null;
  }
}

export function normalizeSafeAvailabilityFromTeeData(
  payload,
  { date = null, tee = 1, includeUnavailable = false } = {},
) {
  const times = payload?.times && typeof payload.times === 'object' ? payload.times : {};
  const slots = [];

  for (const key of Object.keys(times)) {
    const entry = times[key];
    const teeTime = entry?.tee_time || entry;
    const time = normalizeTimeLabel(key || teeTime?.time || entry?.time);
    if (!time) continue;

    const href = normalizeHref(teeTime?.url || entry?.url || entry?.href);
    const bookable = teeTime?.bookable ?? entry?.bookable;
    const state = bookable === true && href
      ? 'bookable'
      : bookable === false
        ? 'unavailable'
        : 'unknown';

    if (!includeUnavailable && state !== 'bookable') continue;

    slots.push({
      date,
      time,
      tee,
      state,
      bookable: state === 'bookable',
      href,
      openSlots: getEntryOpenSlots(entry),
      editable: teeTime?.editable ?? entry?.editable ?? null,
      source: 'brs-tee-data',
    });
  }

  slots.sort((a, b) => a.time.localeCompare(b.time));
  return slots;
}

export function filterSafeProofCandidates(slots, { partySize = 1 } = {}) {
  const size = Math.max(1, Number.parseInt(partySize, 10) || 1);
  return (Array.isArray(slots) ? slots : []).filter((slot) => {
    if (slot?.state !== 'bookable' || slot.bookable !== true || !slot.href) return false;
    const openSlots =
      slot.openSlots === null || slot.openSlots === undefined || slot.openSlots === ''
        ? null
        : Number.isFinite(Number(slot.openSlots))
          ? Number(slot.openSlots)
          : null;
    if (size > 1 && openSlots === null) return false;
    if (openSlots !== null && openSlots < size) return false;
    return true;
  });
}
