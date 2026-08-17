export function validatePartyPlayers({ partySize, players = [] } = {}) {
  const parsedPartySize = Number.parseInt(partySize, 10);
  if (!Number.isInteger(parsedPartySize) || parsedPartySize < 1 || parsedPartySize > 4) {
    return {
      ok: false,
      error: 'invalid-party-size',
      partySize: parsedPartySize,
      expectedAdditionalPlayers: null,
      players: Array.isArray(players) ? players : [],
    };
  }

  const normalizedPlayers = Array.isArray(players)
    ? players.map((player) => String(player ?? '').trim())
    : [];
  const expectedAdditionalPlayers = parsedPartySize - 1;
  if (normalizedPlayers.some((player) => player.length === 0)) {
    return {
      ok: false,
      error: 'missing-player-id',
      partySize: parsedPartySize,
      expectedAdditionalPlayers,
      players: normalizedPlayers,
    };
  }
  if (new Set(normalizedPlayers).size !== normalizedPlayers.length) {
    return {
      ok: false,
      error: 'duplicate-player-id',
      partySize: parsedPartySize,
      expectedAdditionalPlayers,
      players: normalizedPlayers,
    };
  }
  if (normalizedPlayers.length !== expectedAdditionalPlayers) {
    return {
      ok: false,
      error: 'party-player-count-mismatch',
      partySize: parsedPartySize,
      expectedAdditionalPlayers,
      players: normalizedPlayers,
    };
  }

  return {
    ok: true,
    error: null,
    partySize: parsedPartySize,
    expectedAdditionalPlayers,
    players: normalizedPlayers,
  };
}
