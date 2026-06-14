import crypto from 'crypto';

export const ZONE = 'Asia/Taipei';

export const COLLECTIONS = Object.freeze({
  weeks: 'whens_wen_weeks',
  guesses: 'whens_wen_guesses',
  meta: 'whens_wen_meta',
});

export const LEGACY_WEEKS = Object.freeze([
  { weekId: '2026-05-16', status: 'calculated', actualArrivalTime: '12:29', calculatedAt: '2026-05-16T12:29:38+08:00' },
  { weekId: '2026-05-23', status: 'calculated', actualArrivalTime: '12:12', calculatedAt: '2026-05-23T12:51:14+08:00' },
  { weekId: '2026-05-30', status: 'calculated', actualArrivalTime: '12:49', calculatedAt: '2026-05-30T13:01:42+08:00' },
  { weekId: '2026-06-06', status: 'open', actualArrivalTime: '' },
  { weekId: '2026-06-13', status: 'open', actualArrivalTime: '' },
  { weekId: '2026-06-20', status: 'open', actualArrivalTime: '' },
]);

export const LEGACY_GUESSES = Object.freeze([
  ['2026-05-16', 'Stuart', '12:51', '2026-05-16T12:20:05+08:00'],
  ['2026-05-16', 'Sarah', '12:30', '2026-05-16T12:20:43+08:00'],
  ['2026-05-16', 'Denis', '13:22', '2026-05-16T12:21:14+08:00'],
  ['2026-05-16', 'Mikey', '13:30', '2026-05-16T12:21:35+08:00'],
  ['2026-05-23', 'Stuart', '13:05', '2026-05-23T08:43:04+08:00'],
  ['2026-05-23', 'Hughzy the oozy', '23:00', '2026-05-23T09:40:44+08:00'],
  ['2026-05-23', 'Mikey J', '13:10', '2026-05-23T12:12:46+08:00'],
  ['2026-05-30', 'Stuart', '12:33', '2026-05-30T09:52:57+08:00'],
  ['2026-05-30', 'Denis', '12:23', '2026-05-30T11:00:18+08:00'],
  ['2026-05-30', 'Mikey', '13:39', '2026-05-30T12:55:49+08:00'],
  ['2026-06-20', 'Stuart', '14:37', '2026-06-14T12:41:28+08:00'],
  ['2026-06-20', 'Hughzee', '05:41', '2026-06-14T12:41:59+08:00'],
  ['2026-06-20', 'Hugo', '06:46', '2026-06-14T13:09:44+08:00'],
]);

export function currentWeekId(DateTime, now = DateTime.now()) {
  const local = now.setZone(ZONE).startOf('day');
  return local.plus({ days: (6 - local.weekday + 7) % 7 }).toISODate();
}

export function normalizeTime(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return '';
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return '';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function normalizeName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  return name.length >= 2 && name.length <= 40 ? name : '';
}

export function normalizePlayerKey(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
}

export function guessDocumentId(weekId, playerKey) {
  const digest = crypto.createHash('sha256').update(String(playerKey)).digest('hex').slice(0, 24);
  return `${weekId}__${digest}`;
}

export function scoreGuesses(guesses, actualTime) {
  const actualMinutes = timeToMinutes(actualTime);
  const sorted = guesses
    .map((guess) => ({
      ...guess,
      playerName: normalizeName(guess.playerName),
      guessTime: normalizeTime(guess.guessTime),
      difference: Math.abs(timeToMinutes(guess.guessTime) - actualMinutes),
      submittedSort: timestampToMillis(guess.submittedAt),
    }))
    .filter((guess) => guess.playerName && guess.guessTime)
    .sort((a, b) => a.difference - b.difference || a.submittedSort - b.submittedSort || a.playerName.localeCompare(b.playerName));

  let previousDifference = null;
  let previousRank = 0;
  return sorted.map((guess, index) => {
    const rank = previousDifference === guess.difference ? previousRank : index + 1;
    previousDifference = guess.difference;
    previousRank = rank;
    const exactGuess = guess.difference === 0;
    const placeBonus = rank === 1 ? 5 : rank === 2 ? 3 : rank === 3 ? 2 : 0;
    return {
      ...guess,
      rank,
      points: 1 + placeBonus + (exactGuess ? 3 : 0),
      exactGuess,
      weeklyWin: rank === 1,
    };
  });
}

export function aggregateLeaderboard(guesses) {
  const players = new Map();
  for (const guess of guesses) {
    if (!guess?.calculated || !guess?.playerName || !Number.isFinite(Number(guess.points))) continue;
    const key = guess.playerKey || normalizePlayerKey(guess.playerName);
    const player = players.get(key) || {
      playerName: guess.playerName,
      playerKey: key,
      totalPoints: 0,
      weeksPlayed: 0,
      wins: 0,
      exactGuesses: 0,
    };
    player.totalPoints += Number(guess.points);
    player.weeksPlayed += 1;
    player.wins += guess.weeklyWin ? 1 : 0;
    player.exactGuesses += guess.exactGuess ? 1 : 0;
    players.set(key, player);
  }

  return [...players.values()]
    .sort((a, b) => b.totalPoints - a.totalPoints || b.wins - a.wins || b.exactGuesses - a.exactGuesses || a.playerName.localeCompare(b.playerName))
    .map((player, index) => ({ position: index + 1, ...player }));
}

export function serializeGuess(data) {
  return {
    playerName: data.playerName || '',
    guessTime: data.guessTime || '',
    submittedAt: data.submittedAt?.toDate?.()?.toISOString?.() || data.submittedAt || '',
    calculated: Boolean(data.calculated),
    difference: Number.isFinite(Number(data.difference)) ? Number(data.difference) : null,
    rank: Number.isFinite(Number(data.rank)) ? Number(data.rank) : null,
    points: Number.isFinite(Number(data.points)) ? Number(data.points) : null,
    exactGuess: Boolean(data.exactGuess),
    weeklyWin: Boolean(data.weeklyWin),
  };
}

export function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function publicError(message, status = 400) {
  const error = new Error(message);
  error.publicStatus = status;
  return error;
}

function timeToMinutes(value) {
  const time = normalizeTime(value);
  if (!time) throw publicError(`Invalid time: ${value}`, 400);
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

function timestampToMillis(value) {
  if (value?.toMillis) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}
