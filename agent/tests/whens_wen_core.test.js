import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateLeaderboard,
  normalizeName,
  normalizeTime,
  scoreGuesses,
} from '../whens_wen/core.js';

test('normalizes names and valid 24-hour times', () => {
  assert.equal(normalizeName('  Hughzy   the oozy '), 'Hughzy the oozy');
  assert.equal(normalizeTime('5:41'), '05:41');
  assert.equal(normalizeTime('24:00'), '');
});

test('scores closest, second and third guesses', () => {
  const scored = scoreGuesses([
    { id: 'a', playerName: 'Sarah', guessTime: '12:30', submittedAt: '2026-05-16T12:20:43+08:00' },
    { id: 'b', playerName: 'Stuart', guessTime: '12:51', submittedAt: '2026-05-16T12:20:05+08:00' },
    { id: 'c', playerName: 'Denis', guessTime: '13:22', submittedAt: '2026-05-16T12:21:14+08:00' },
  ], '12:29');

  assert.deepEqual(
    scored.map(({ playerName, rank, points, difference }) => ({ playerName, rank, points, difference })),
    [
      { playerName: 'Sarah', rank: 1, points: 6, difference: 1 },
      { playerName: 'Stuart', rank: 2, points: 4, difference: 22 },
      { playerName: 'Denis', rank: 3, points: 3, difference: 53 },
    ],
  );
});

test('ties share the same rank and bonus', () => {
  const scored = scoreGuesses([
    { id: 'a', playerName: 'Ann', guessTime: '12:29', submittedAt: '2026-01-01T00:00:00Z' },
    { id: 'b', playerName: 'Ben', guessTime: '12:31', submittedAt: '2026-01-01T00:01:00Z' },
  ], '12:30');
  assert.deepEqual(
    scored.map((item) => [item.rank, item.points, item.weeklyWin]),
    [[1, 6, true], [1, 6, true]],
  );
});

test('aggregates a league table from calculated guesses', () => {
  const table = aggregateLeaderboard([
    { playerName: 'Stuart', playerKey: 'stuart', calculated: true, points: 4, weeklyWin: false, exactGuess: false },
    { playerName: 'Stuart', playerKey: 'stuart', calculated: true, points: 6, weeklyWin: true, exactGuess: false },
    { playerName: 'Sarah', playerKey: 'sarah', calculated: true, points: 6, weeklyWin: true, exactGuess: false },
  ]);
  assert.equal(table[0].playerName, 'Stuart');
  assert.equal(table[0].totalPoints, 10);
  assert.equal(table[0].weeksPlayed, 2);
});
