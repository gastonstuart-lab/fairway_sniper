export function countOpenParticipantSlots(participants, maxSlots = 4) {
  if (!Array.isArray(participants)) return null;
  const capacity = Number.isFinite(Number(maxSlots))
    ? Math.max(1, Number(maxSlots))
    : 4;
  if (participants.length === 0) return capacity;

  const emptyPlaceholders = participants.filter((participant) => {
    const name = participant?.name ?? participant?.player_name ?? participant?.full_name;
    const id = participant?.id ?? participant?.member_id ?? participant?.player_id;
    return (
      (name === null || name === undefined || String(name).trim() === '') &&
      (id === null || id === undefined || String(id).trim() === '')
    );
  }).length;
  if (emptyPlaceholders > 0) return emptyPlaceholders;

  const occupied = participants.filter((participant) => {
    const name = participant?.name ?? participant?.player_name ?? participant?.full_name;
    const id = participant?.id ?? participant?.member_id ?? participant?.player_id;
    return (
      (name !== null && name !== undefined && String(name).trim() !== '') ||
      (id !== null && id !== undefined && String(id).trim() !== '')
    );
  }).length;
  return Math.max(0, capacity - occupied);
}

export function getEntryOpenSlots(entry) {
  const teeTime = entry?.tee_time || entry;
  const direct = teeTime?.open_slots ?? teeTime?.openSlots ?? entry?.open_slots ?? entry?.openSlots;
  const parsed = Number.parseInt(direct, 10);
  if (Number.isFinite(parsed)) return parsed;
  const maxSlots =
    teeTime?.max_players ??
    teeTime?.players_max_allowed ??
    teeTime?.capacity ??
    entry?.max_players ??
    entry?.players_max_allowed ??
    entry?.capacity ??
    4;
  return countOpenParticipantSlots(teeTime?.participants || entry?.participants, maxSlots);
}
