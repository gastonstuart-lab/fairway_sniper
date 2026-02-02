import 'dotenv/config';

const agentUrl = process.env.AGENT_URL || 'http://localhost:3000';
const username = process.env.BRS_USERNAME || process.env.BRS_EMAIL;
const password = process.env.BRS_PASSWORD;
const targetDate = process.env.BRS_TARGET_DATE; // e.g. 2026-02-06
const preferredTimes = (process.env.BRS_PREFERRED_TIMES || '').split(',').map(s => s.trim()).filter(Boolean);
const partySize = Number.parseInt(process.env.BRS_PARTY_SIZE || '1', 10);

if (!username || !password || !targetDate) {
  console.error('Missing required env vars: BRS_USERNAME/BRS_EMAIL, BRS_PASSWORD, BRS_TARGET_DATE');
  process.exit(1);
}

const fireTimeUtc = new Date(Date.now() + 90_000).toISOString();

const payload = {
  username,
  password,
  targetDate,
  fireTimeUtc,
  preferredTimes,
  partySize,
};

const logPayload = {
  ...payload,
  password: password ? '***' : '',
};

console.log('📡 Calling /api/release-snipe with payload:');
console.log(JSON.stringify(logPayload, null, 2));

const res = await fetch(`${agentUrl}/api/release-snipe`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

if (!res.ok) {
  const text = await res.text();
  console.error(`Request failed: ${res.status} ${text}`);
  process.exit(1);
}

const data = await res.json();
console.log('✅ Response:');
console.log(JSON.stringify(data, null, 2));
