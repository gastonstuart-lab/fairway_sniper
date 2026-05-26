import 'dotenv/config';

const AGENT_URL = process.env.AGENT_URL || 'https://fairwaysniper-production.up.railway.app';
const username = process.env.BRS_USERNAME || process.env.BRS_EMAIL;
const password = process.env.BRS_PASSWORD;
const targetDate = process.env.TARGET_DATE || process.env.BRS_TARGET_DATE || '';
const preferredTimes = (process.env.PREFERRED_TIMES || process.env.BRS_PREFERRED_TIMES || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const players = (process.env.PLAYERS || process.env.BRS_PLAYERS || '16524,14481,730')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const partySize = Number.parseInt(process.env.PARTY_SIZE || process.env.BRS_PARTY_SIZE || '4', 10);
const expectedBookerName = process.env.EXPECTED_BOOKER_NAME || 'Sharpe, Mal';
const expectedBookerId = process.env.EXPECTED_BOOKER_ID || '685';
const expectedGitPrefix = process.env.EXPECTED_GIT_PREFIX || '';
const runReleaseDryRun = process.env.RUN_RELEASE_DRY_RUN === 'true';

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

async function postJson(path, body, timeoutMs = 120000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${AGENT_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    if (!response.ok) {
      throw new Error(`${path} ${response.status}: ${JSON.stringify(json)}`);
    }
    return json;
  } finally {
    clearTimeout(timeout);
  }
}

async function getJson(path, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${AGENT_URL}${path}`, { signal: controller.signal });
    const json = await response.json();
    if (!response.ok) throw new Error(`${path} ${response.status}: ${JSON.stringify(json)}`);
    return json;
  } finally {
    clearTimeout(timeout);
  }
}

function flattenPlayers(directory) {
  return (directory.categories || []).flatMap((category) =>
    (category.players || []).map((player) => ({ ...player, category: category.name })),
  );
}

console.log(`Preflight agent: ${AGENT_URL}`);

if (!username || !password) fail('Missing BRS_USERNAME/BRS_EMAIL and BRS_PASSWORD');
if (!Number.isFinite(partySize) || partySize < 1 || partySize > 4) fail(`Invalid PARTY_SIZE: ${partySize}`);
if (players.length !== Math.max(0, partySize - 1)) {
  fail(`PLAYERS count ${players.length} does not match PARTY_SIZE ${partySize}`);
}
if (new Set(players).size !== players.length) fail(`Duplicate PLAYERS values: ${players.join(',')}`);

const runtime = await getJson('/api/runtime-status');
console.log(
  `Runtime: git=${runtime.gitHash} firebase=${runtime.firebaseAdminReady} runner=${runtime.sniperRunnerStarted} safe=${runtime.safeMode}`,
);
if (expectedGitPrefix && !String(runtime.gitHash || '').startsWith(expectedGitPrefix)) {
  fail(`Railway git hash is ${runtime.gitHash}, expected prefix ${expectedGitPrefix}`);
}
if (runtime.firebaseAdminReady !== true) fail('Firebase Admin is not ready');
if (runtime.agentRunMain !== true || runtime.sniperRunnerStarted !== true) {
  fail('Firestore sniper runner is not enabled');
}
if (runtime.safeMode !== false) fail('SAFE_MODE is not false');

const directory = await postJson('/api/brs/player-directory', { username, password }, 120000);
const allPlayers = flattenPlayers(directory);
const youCategory = (directory.categories || []).find((category) => category.name === 'You');
const you = youCategory?.players?.[0] || null;
console.log(`Booker: ${you?.name || directory.currentUserName || 'unknown'} (${you?.id || 'no id'})`);
if (expectedBookerName && you?.name !== expectedBookerName) {
  fail(`Booker name is ${you?.name || 'unknown'}, expected ${expectedBookerName}`);
}
if (expectedBookerId && String(you?.id || '') !== expectedBookerId) {
  fail(`Booker id is ${you?.id || 'unknown'}, expected ${expectedBookerId}`);
}

for (const playerId of players) {
  const matches = allPlayers.filter((player) => String(player.id) === String(playerId));
  if (!matches.length) {
    fail(`Player id ${playerId} not found in Malcolm's directory`);
    continue;
  }
  const names = matches.map((player) => `${player.name} [${player.category}]`).join('; ');
  console.log(`Player ${playerId}: ${names}`);
}

if (targetDate) {
  const teeData = await postJson(
    '/api/fetch-tee-times',
    {
      username,
      password,
      date: targetDate,
      targetDate,
      includeUnavailable: true,
      tee: 1,
    },
    120000,
  );
  const slots = Array.isArray(teeData.slots) ? teeData.slots : [];
  const times = slots.length
    ? slots.filter((slot) => preferredTimes.includes(slot.time)).map((slot) => ({
        time: slot.time,
        state: slot.state,
        openSlots: slot.openSlots,
        href: Boolean(slot.href),
      }))
    : [];
  console.log(`Target ${targetDate}: fetched ${slots.length || teeData.times?.length || 0} tee entries`);
  if (preferredTimes.length) console.log(`Preferred target entries: ${JSON.stringify(times)}`);
}

if (runReleaseDryRun) {
  if (!targetDate || !preferredTimes.length) {
    fail('RUN_RELEASE_DRY_RUN=true requires TARGET_DATE and PREFERRED_TIMES');
  } else {
    const dryRun = await postJson(
      '/api/release-snipe',
      {
        username,
        password,
        targetDate,
        fireTimeUtc: new Date(Date.now() + 5000).toISOString(),
        preferredTimes,
        players,
        partySize,
        dryRun: true,
        teeTarget: 1,
      },
      180000,
    );
    console.log(`Dry-run: success=${dryRun.success} result=${dryRun.result} error=${dryRun.error || ''}`);
    console.log(`Dry-run notes: ${dryRun.notes || ''}`);
  }
}

if (process.exitCode) {
  console.error('Preflight verdict: NOT READY');
  process.exit(process.exitCode);
}

console.log('Preflight verdict: BASELINE READY');
