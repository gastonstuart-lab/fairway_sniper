export function normalizeTimeLabel(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return null;
  const hhmm = digits.padStart(4, '0').slice(-4);
  const hour = Number.parseInt(hhmm.slice(0, 2), 10);
  const minute = Number.parseInt(hhmm.slice(2), 10);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${hhmm.slice(0, 2)}:${hhmm.slice(2)}`;
}

export function normalizePreferredTimeLabels(preferredTimes) {
  const seen = new Set();
  const labels = [];
  for (const time of Array.isArray(preferredTimes) ? preferredTimes : []) {
    const label = normalizeTimeLabel(time);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels;
}

export function normalizeDateKey(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    if (/^\d{8}$/.test(trimmed)) {
      return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6)}`;
    }
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

export function normalizeTee(value) {
  if (value === 10 || String(value || '').trim() === '10') return 10;
  if (value === 1 || String(value || '').trim() === '1') return 1;
  return null;
}

export function extractDateKeyFromHref(href) {
  try {
    const parsed = new URL(String(href || ''), 'https://members.brsgolf.com');
    const segments = parsed.pathname.split('/').filter(Boolean);
    for (let index = segments.length - 1; index >= 0; index -= 1) {
      if (/^\d{8}$/.test(segments[index])) return normalizeDateKey(segments[index]);
    }
  } catch {
    return null;
  }
  return null;
}

export function buildSlotPolicy({ targetDate, tee, preferredTimes, partySize }) {
  return {
    targetDate: normalizeDateKey(targetDate),
    tee: normalizeTee(tee),
    preferredTimes: normalizePreferredTimeLabels(preferredTimes),
    partySize: Math.max(1, Number.parseInt(partySize, 10) || 1),
  };
}

export function evaluateSlotCandidate(policy, candidate = {}) {
  const reasons = [];
  const selectedDate = normalizeDateKey(candidate.date || extractDateKeyFromHref(candidate.href));
  const selectedTee = normalizeTee(candidate.tee);
  const selectedTime = normalizeTimeLabel(candidate.time);
  const preferredIndex = policy.preferredTimes.indexOf(selectedTime);
  const openSlots = Number.isFinite(Number(candidate.openSlots)) ? Number(candidate.openSlots) : null;

  if (!policy.targetDate) reasons.push('missing-target-date');
  if (!policy.tee) reasons.push('missing-requested-tee');
  if (!policy.preferredTimes.length) reasons.push('missing-preferred-times');
  if (selectedDate && policy.targetDate && selectedDate !== policy.targetDate) reasons.push('wrong-date');
  if (!selectedDate) reasons.push('missing-candidate-date');
  if (selectedTee && policy.tee && selectedTee !== policy.tee) reasons.push('wrong-tee');
  if (!selectedTee) reasons.push('missing-candidate-tee');
  if (!selectedTime || preferredIndex < 0) reasons.push('wrong-time');
  if (policy.partySize > 1 && openSlots === null) reasons.push('capacity-unproven');
  if (openSlots !== null && openSlots < policy.partySize) reasons.push('insufficient-capacity');

  return {
    accepted: reasons.length === 0,
    reasons,
    selectedDate,
    selectedTee,
    selectedTime,
    preferredIndex: preferredIndex >= 0 ? preferredIndex : Number.MAX_SAFE_INTEGER,
    openSlots,
  };
}

export function filterAndRankCandidates(policy, candidates) {
  const accepted = [];
  const rejected = [];
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const evaluation = evaluateSlotCandidate(policy, candidate);
    const record = { ...candidate, evaluation };
    if (evaluation.accepted) {
      accepted.push(record);
    } else {
      rejected.push(record);
    }
  }
  accepted.sort((a, b) => {
    if (a.evaluation.preferredIndex !== b.evaluation.preferredIndex) {
      return a.evaluation.preferredIndex - b.evaluation.preferredIndex;
    }
    return String(a.evaluation.selectedTime || '').localeCompare(String(b.evaluation.selectedTime || ''));
  });
  return { accepted, rejected };
}
