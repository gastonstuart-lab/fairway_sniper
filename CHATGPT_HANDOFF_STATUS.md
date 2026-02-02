# Fairway Sniper — Technical Status Report (Feb 1, 2026)

This file is ready to share with ChatGPT for full context.

---

## Step 1 — Repo + Commit State

**Commands run (output):**
- `git branch`
  ```
    feat/booking-refactor-clean
    feat/sniper-stable
  * fix/sniper-wizard
    main
  ```

- `git status --short`
  ```
   M .vscode/settings.json
   M agent/start-agent-detached.ps1
   M lib/screens/dashboard_screen.dart
   M lib/screens/new_job_wizard.dart
   M lib/services/availability_cache_service.dart
   M lib/services/booking_prefetch_service.dart
   M lib/services/player_directory_service.dart
   M lib/widgets/player_selector_modal.dart
  ?? TEST_NORMAL_MODE.ps1
  ?? TEST_SNIPER_MODE.ps1
  ?? _handover/
  ?? agent/TASK_PLAN.md
  ?? agent/express-test.js
  ?? agent/index.cjs
  ?? agent/payload.json
  ?? agent/test-fetch-range-env.ps1
  ?? agent/test-sniper-now.ps1
  ?? ersstuarProjectsfairway_sniper
  ?? scripts/
  ```

- `git log -15 --oneline`
  ```
  1998178 (HEAD -> fix/sniper-wizard, origin/fix/sniper-wizard) Fix sniper wizard time grid and skip creds page
  f6a9aa3 Guard fetch-tee-times against wrong date
  339f2da Fix tee time player counting to ignore left-side labels
  d22dd63 (feat/booking-refactor-clean) chore: release-candidate snapshot before release-snipe work
  841c8e9 WIP: agent connectivity + firebase admin next step
  dd1b6f7 WIP: Sync latest working state for review (Select2 scraping, booking fixes, diagnostics cleanup)
  bf13c94 Ignore runtime outputs and test artifacts
  cc29d00 Fix Select2 player directory scraping and reuse booking navigation logic for robust player extraction
  1499f92 chore: ignore build artifacts and add test report
  85e18d0 (feat/sniper-stable) feat: refactor booking automation with robust player selection
  b9247d6 PRODUCTION READY: Complete sniper automation + unified API
  a647202 Fairway Sniper nearly complete
  7e38fea docs: add quick start testing guide for live booking validation
  b898c13 docs: add session summary - form inspection and player population implementation complete
  812303e docs: add comprehensive form inspection documentation and booking test script
  ```

**Summary:**
- Current branch: **fix/sniper-wizard**
- Last known good commit: **1998178**
- Working directory: **dirty** (modified + untracked files)

---

## Step 2 — Current API Routes (agent/index.js)

**/api/health**
- Returns `{ status: 'ok', service: 'fairway-sniper-agent' }`.

**/api/book-now**
- Runs immediate booking using `runBooking()` with `useReleaseObserver: false`.

**/api/release-snipe** (full handler code):
```
app.post('/api/release-snipe', async (req, res) => {
  try {
    const { username, password, targetDate, fireTimeUtc, preferredTimes, partySize } = req.body;
    if (!username || !password || !targetDate) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    // Default: fireTimeUtc = 1 min from now if not provided
    let fireTime = fireTimeUtc ? new Date(fireTimeUtc).getTime() : Date.now() + 60000;
    // Default: preferredTimes = []
    const times = Array.isArray(preferredTimes) ? preferredTimes : [];
    // Warm preload
    const warmPage = await warmSession.getWarmPage(targetDate, username, password);
    // Schedule fire
    const now = Date.now();
    if (fireTime > now) {
      await coarseWaitUntil(fireTime);
    }
    // Run booking with release observer
    const result = await runBooking({
      jobId: 'release-snipe-' + Date.now(),
      ownerUid: 'release-night',
      loginUrl: CONFIG.CLUB_LOGIN_URL,
      username,
      password,
      preferredTimes: times,
      targetFireTime: fireTime,
      targetPlayDate: targetDate,
      players: [],
      partySize,
      slotsData: [],
      warmPage,
      useReleaseObserver: true,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

---

## Step 3 — Sniper Job Tracking Logic

Search results:
- `runStatus` appears **only** in `agent/index.cjs`.
- `jobStore = new Map()` exists in `agent/index.js`.
- `crypto.randomUUID` **not found**.

**Conclusion:**
- Async “accept + runId” pattern is **not implemented** in `agent/index.js`.
- `/api/release-snipe` is still **blocking** (awaits `runBooking()` before responding).

---

## Step 4 — Tee Sheet Detection + Time Matching

### Relevant functions in `agent/index.js`

**`waitForTeeSheet()`**
```
async function waitForTeeSheet(page, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    await acceptCookies(page);
    const dateHeader = page.locator('button', { hasText: /JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC/i }).first();
    const anyTime = page.locator('text=/\\b(?:0?\\d|1\\d|2[0-3]):[0-5]\\d\\b/').first();
    const anyRow = page.locator('tr').first();
    if (await dateHeader.isVisible().catch(() => false)) return true;
    if (await anyTime.isVisible().catch(() => false)) return true;
    if (await anyRow.isVisible().catch(() => false)) return true;
    await page.waitForTimeout(200);
  }
  throw new Error('Tee sheet not detected within timeout');
}
```

**`scrapeAvailableTimes()`** — full function copied from `agent/index.js` (see repository if needed).

**Time normalization + preferred time matching**
```
function normalizeTimeToHHMM(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.padStart(4, '0').slice(-4);
}

const locatorCache = {};
for (const time of normalizedPreferredTimes) {
  const hhmm = normalizeTimeToHHMM(time);
  if (!hhmm || hhmm.length !== 4) {
    console.log(`[WARN] Skipping invalid time format in preferredTimes: "${time}"`);
    continue;
  }
  const fallbackSel = `a[href*="/bookings/book/${hhmm}"]`;
  const cachedSel = cachedSelectors?.[time] || fallbackSel;
  locatorCache[time] = page.locator(cachedSel).first();
}
```

**Selectors used:**
- Tee time text: `text=/\b(?:0?\d|1\d|2[0-3]):[0-5]\d\b/`
- Rows: `tr, .tee-row, .slot-row, .timeslot, .slot, .availability, [role="row"]`
- Booking link: `a[href*="/bookings/book"]` or `a[href*="/bookings/book/${hhmm}"]`

**Normalization:**
- “8.20” → `0820`, “08:20” → `0820`

**Likely miss causes:**
- Time not rendered as text matching regex.
- Virtualized rows not in DOM at scan time.
- Rows without “Book” button are skipped unless `includeUnavailable` is true.

---

## Step 5 — MutationObserver Release Watcher

Code in `agent/index.js`:
```
async function waitForBookingRelease(page, timeoutMs = 2000) {
  return await page.evaluateHandle((timeout) => {
    return new Promise((resolve) => {
      let done = false;
      const start = Date.now();
      const observer = new MutationObserver(() => {
        if (done) return;
        const link = document.querySelector('a[href*="/bookings/book"]');
        if (link) {
          done = true;
          const slotText = link.textContent || '';
          const match = slotText.match(/\b(\d{1,2}:\d{2})\b/);
          const slotTime = match ? match[1] : null;
          resolve({
            found: true,
            elapsedMs: Date.now() - start,
            slotTime,
          });
          observer.disconnect();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => {
        if (!done) {
          done = true;
          resolve({ found: false, elapsedMs: Date.now() - start });
          observer.disconnect();
        }
      }, timeout);
    });
  }, timeoutMs).then(h => h.jsonValue ? h.jsonValue() : h);
}
```

**Answers:**
- Watcher arms **after** `spinUntil(targetFireTime)`.
- May miss links that are already present before observer starts.

---

## Step 6 — Recent Failure Logs / Artifacts

- `.last-run.json`: not found
- `agent/output/*.html`: present (e.g., `debug-no-times-2025-12-05T05-41-10-647Z.html`, `no-table-2025-12-08.html`)
- No “tee time not found” log lines found

Recent log tail shows repeated warm tee-sheet loads with no explicit failures.

---

## Step 7 — Clean Handoff Summary

**Current working version commit:** 1998178 (fix/sniper-wizard)

**What is broken right now:**
- No explicit failure in logs; known non-blocking issue is Firestore permission-denied logging for player directory caching.
- `/api/release-snipe` remains blocking (no async `runId` response).

**What file/function must be fixed next:**
- If async refactor is needed, update `/api/release-snipe` in `agent/index.js` and add `runStatus` + non-blocking run tracking (pattern exists only in `agent/index.cjs`).

**Async refactor status:**
- **Pending** in `agent/index.js`.

---

End of report.
