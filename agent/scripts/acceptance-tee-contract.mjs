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

const planCheck = async (date, label) => {
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
  assert(tee1Count > 0, `${label} tee1 list is empty`);
  assert(tee10Count > 0, `${label} tee10 list is empty`);
  const tee1Sample = data.tee1.times.slice(0, 5).join(',');
  const tee10Sample = data.tee10.times.slice(0, 5).join(',');
  assert(tee1Sample !== tee10Sample, `${label} tee lists appear identical`);
  console.log(
    `[${label}] tee counts tee1=${tee1Count} tee10=${tee10Count} delta=${Math.abs(
      tee1Count - tee10Count,
    )}`,
  );
  return data;
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

    const weekendData = await planCheck(WEEKEND_DATE, 'weekend');
    const weekdayData = await planCheck(WEEKDAY_DATE, 'weekday');
    console.log(
      `[weekday] tee1/tee10 first-time delta: ${Math.abs(
        weekdayData.tee1.times[0].length - weekdayData.tee10.times[0].length,
      )} (not used for pass/fail)`,
    );

    const chosenTime = weekendData.tee10.times[0];
    assert(chosenTime, 'No tee10 time was available for dry-run checks');

    const bookNowResult = await runDryRunBooking(WEEKEND_DATE, chosenTime, '/api/book-now');
    assert(bookNowResult.teeSelected === '10TH TEE', 'book-now dry-run did not honor tee 10');
    assert(bookNowResult.armedAfterTeeSelect === true, 'book-now dry-run did not record tee readiness');
    console.log('book-now dry-run confirmed teeTarget=10');

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

    console.log('Acceptance tee contract checks PASSED');
    process.exit(0);
  } catch (error) {
    console.error('Acceptance tee contract failed:', error?.message || error);
    process.exit(1);
  }
})();
