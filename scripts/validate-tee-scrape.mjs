#!/usr/bin/env node

const AGENT_URL = process.env.AGENT_URL || 'http://127.0.0.1:3000';
const TARGET_DATE = process.argv[2] || process.env.TEE_SCRAPE_DATE || '2026-02-08';
const USERNAME = process.env.BRS_USERNAME;
const PASSWORD = process.env.BRS_PASSWORD;

if (!USERNAME || !PASSWORD) {
  console.error('[validate-tee-scrape] Missing BRS credentials (set BRS_USERNAME and BRS_PASSWORD).');
  process.exitCode = 1;
  process.exit();
}

const tees = [1, 10];
let failed = false;
const teeResults = new Map();

const formatCounts = (counts) =>
  Object.entries(counts)
    .sort()
    .map(([state, count]) => `${state}:${count}`)
    .join(', ') || 'none';

const countStates = (slots = []) => {
  return slots.reduce((acc, slot) => {
    const state = String(slot?.state || 'unknown').toLowerCase();
    acc[state] = (acc[state] || 0) + 1;
    return acc;
  }, {});
};

const arraysEqual = (a = [], b = []) => {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
};

const fetchTimes = async (tee) => {
  const response = await fetch(`${AGENT_URL}/api/fetch-tee-times`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ date: TARGET_DATE, username: USERNAME, password: PASSWORD, tee }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => 'failed to read response');
    throw new Error(`Request failed ${response.status} ${response.statusText} | ${text}`);
  }
  return response.json();
};

const main = async () => {
  console.log(`[validate-tee-scrape] Running against ${AGENT_URL} for ${TARGET_DATE}`);
  for (const tee of tees) {
    try {
      const result = await fetchTimes(tee);
      const { success, times, slots, debug } = result || {};
      if (!success || !Array.isArray(times)) {
        throw new Error(`unexpected response payload: ${JSON.stringify(result)}`);
      }
      if (times.length === 0) {
        const info = debug
          ? ` | debug url=${debug.url} bodyTextLen=${debug.bodyTextLen}`
          : '';
        throw new Error(`times array empty${info}`);
      }
      const stateCounts = countStates(slots);
      teeResults.set(tee, { times, stateCounts });
      console.log(
        `[validate-tee-scrape] tee=${tee} → ${times.length} times (states: ${formatCounts(stateCounts)}) | first 5: ${times
          .slice(0, 5)
          .join(', ')}`,
      );
    } catch (error) {
      failed = true;
      console.error(`[validate-tee-scrape] tee=${tee} ERROR: ${error.message}`);
    }
  }

  if (failed) {
    console.error('[validate-tee-scrape] One or more tee queries failed.');
    process.exitCode = 1;
    return;
  }

  const tee1 = teeResults.get(1)?.times || [];
  const tee10 = teeResults.get(10)?.times || [];
  if (tee1.length === 0 || tee10.length === 0) {
    console.error('[validate-tee-scrape] Unexpected empty tee results after validation loop.');
    process.exitCode = 1;
    return;
  }

  if (arraysEqual(tee1, tee10)) {
    console.error('[validate-tee-scrape] tee=1 and tee=10 returned identical times (expected difference).');
    process.exitCode = 1;
    return;
  }

  console.log('[validate-tee-scrape] tee=1 and tee=10 returned distinct time lists.');
};

main().catch((error) => {
  console.error('[validate-tee-scrape] Unhandled error:', error);
  process.exitCode = 1;
});
