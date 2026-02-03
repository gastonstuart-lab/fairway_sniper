const AGENT_URL = process.env.AGENT_URL;
const USERNAME = process.env.BRS_USERNAME;
const PASSWORD = process.env.BRS_PASSWORD;
const WEEKEND_DATE = process.env.TEE_SCRAPE_DATE || '2026-02-08';
const WEEKDAY_DATE = process.env.TEE_SCRAPE_WEEKDAY || '2026-02-09';

if (!AGENT_URL) {
  console.error('AGENT_URL is required to run acceptance-tee-contract');
  process.exit(1);
}

if (!USERNAME || !PASSWORD) {
  console.error('BRS_USERNAME and BRS_PASSWORD are required for authenticated requests');
  process.exit(1);
}

const jsonHeaders = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
};

const fetchJson = async (path, options = {}) => {
  const res = await fetch(`${AGENT_URL}${path}`, {
    headers: jsonHeaders,
    ...options,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${path} ${res.status}: ${body}`);
  }
  return res.json();
};

const logCounts = (label, tee1Count, tee10Count) => {
  console.log(
    `[${label}] tee counts tee1=${tee1Count} tee10=${tee10Count} delta=${Math.abs(
      tee1Count - tee10Count,
    )}`,
  );
};

const printDebug = (label, debug) => {
  if (!debug) return;
  console.warn(`[${label}] debug reason=${debug.reason || 'unknown'} url=${debug.url}`);
  console.warn(`[${label}] bodyTextLen=${debug.bodyTextLen || 'n/a'} first300=${debug.first300 || ''}`);
  if (debug.screenshotPath) {
    console.warn(`[${label}] screenshot: ${debug.screenshotPath}`);
  }
};

const fetchTeeData = async (date, label) => {
  const payload = {
    date,
    username: USERNAME,
    password: PASSWORD,
    teeMode: 'both',
    includeUnavailable: true,
  };
  const data = await fetchJson('/api/fetch-tee-times', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const tee1Count = Array.isArray(data.tee1?.times) ? data.tee1.times.length : 0;
  const tee10Count = Array.isArray(data.tee10?.times) ? data.tee10.times.length : 0;
  logCounts(label, tee1Count, tee10Count);
  return { data, tee1Count, tee10Count };
};

const ensureListsDiffer = (label, data) => {
  const tee1Sample = (data.tee1?.times || []).slice(0, 5).join(',');
  const tee10Sample = (data.tee10?.times || []).slice(0, 5).join(',');
  assert(tee1Sample !== tee10Sample, `${label} tee lists appear identical`);
};

const ensureRequiredWeekendTimes = (data) => {
  const required10Times = ['09:12', '09:52'];
  for (const required of required10Times) {
    assert(
      Array.isArray(data.tee10?.times) && data.tee10.times.includes(required),
      `weekend tee10 missing expected slot ${required}`,
    );
  }
};

const runWeekendCheck = async () => {
  const label = 'weekend';
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const { data, tee1Count, tee10Count } = await fetchTeeData(WEEKEND_DATE, label);
    if (tee1Count > 0 && tee10Count > 0) {
      ensureListsDiffer(label, data);
      ensureRequiredWeekendTimes(data);
      return data;
    }
    if (attempt >= 2) {
      console.error(`[${label}] tee1 or tee10 still empty after retries`);
      if (tee1Count === 0) {
        printDebug(`${label} tee1`, data.tee1?.debug);
      }
      if (tee10Count === 0) {
        printDebug(`${label} tee10`, data.tee10?.debug);
      }
      throw new Error('weekend tee buckets failed to load');
    }
    console.log(`[${label}] tee1/tee10 empty, retrying in 2000ms`);
    await delay(2000);
  }
};

const findWeekdayData = async (startDate) => {
  const isWeekday = (date) => date.getDay() >= 1 && date.getDay() <= 5;
  const base = new Date(startDate);
  for (let offset = 0; offset < 14; offset += 1) {
    const candidate = new Date(base);
    candidate.setDate(base.getDate() + offset);
    if (!isWeekday(candidate)) continue;
    const iso = candidate.toISOString().slice(0, 10);
    const label = `weekday-${iso}`;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const { data, tee1Count, tee10Count } = await fetchTeeData(iso, label);
      if (tee1Count > 0) {
        if (tee10Count === 0) {
          const loadError =
            (data.tee10?.debug?.first300 || '').toLowerCase().includes('could not be loaded');
          const reason = data.tee10?.debug?.reason;
          console.warn(
            `[${label}] tee10 empty (expected weekdays) reason=${reason || 'unknown'}${
              loadError ? ' (load error detected)' : ''
            }`,
          );
        } else {
          ensureListsDiffer(label, data);
        }
        return { data, iso };
      }
      if (attempt >= 3) {
        console.warn(`[${label}] tee1 still empty after retries; moving to next weekday`);
        printDebug(`${label} tee1`, data.tee1?.debug);
        break;
      }
      const waitMs = attempt === 1 ? 1500 : 2500;
      console.log(`[${label}] tee1 empty; retrying in ${waitMs}ms`);
      await delay(waitMs);
    }
  }
  throw new Error('No weekday tee1 data available after checking multiple dates');
};

const runDryRunBooking = async (targetDate, time, endpoint, payloadExtras = {}) => {
  const payload = {
    username: USERNAME,
    password: PASSWORD,
    preferredTimes: [time],
    teeTarget: 10,
    dryRun: true,
    ...(endpoint === '/api/book-now' ? { targetDate } : { targetDate, fireTimeUtc: new Date(Date.now() + 5000).toISOString() }),
    ...payloadExtras,
  };
  return fetchJson(endpoint, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
};

(async () => {
  try {
    console.log('Agent URL:', AGENT_URL);
    const version = await fetchJson('/api/version');
    console.log('Agent version:', version);

    const weekendData = await runWeekendCheck();
    const { data: weekdayData, iso: weekdayUsed } = await findWeekdayData(WEEKDAY_DATE);
    const weekdayTee10Count = Array.isArray(weekdayData.tee10?.times) ? weekdayData.tee10.times.length : 0;
    console.log(`[weekday ${weekdayUsed}] tee1 count=${weekdayData.tee1.times.length} tee10 count=${weekdayTee10Count}`);

    const chosenTime = weekendData.tee10.times[0];
    assert(chosenTime, 'No tee10 time was available for dry-run checks');

    const bookNowResult = await runDryRunBooking(WEEKEND_DATE, chosenTime, '/api/book-now');
    assert(bookNowResult.teeSelected === '10TH TEE', 'book-now dry-run did not honor tee 10');
    assert(bookNowResult.armedAfterTeeSelect === true, 'book-now dry-run did not record tee readiness');
    console.log('book-now dry-run confirmed teeTarget=10');
    console.log(`book-now dry-run teeSelected=${bookNowResult.teeSelected} armedAfterTeeSelect=${bookNowResult.armedAfterTeeSelect}`);

    const releaseResult = await runDryRunBooking(
      WEEKEND_DATE,
      chosenTime,
      '/api/release-snipe',
      { fallbackTee: false },
    );
    assert(releaseResult.teeSelected === '10TH TEE', 'release-snipe dry-run did not honor tee 10');
    assert(
      releaseResult.armedAfterTeeSelect === true,
      'release-snipe dry-run did not confirm tee selection before watcher',
    );
    console.log('release-snipe dry-run confirmed teeTarget=10');
    console.log(`release-snipe teeSelected=${releaseResult.teeSelected} armedAfterTeeSelect=${releaseResult.armedAfterTeeSelect}`);

    console.log('Acceptance tee contract checks PASSED');
    process.exit(0);
  } catch (error) {
    console.error('Acceptance tee contract failed:', error?.message || error);
    process.exit(1);
  }
})();
