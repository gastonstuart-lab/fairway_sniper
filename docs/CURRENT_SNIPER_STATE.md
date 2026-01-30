# Current Sniper State (Fairway Sniper)

## A) Warm Session

- **Where is launchPersistentContext created?**
  - In `agent/warm_session.js`, function `ensureContext()`:
    - `warmContext = await chromium.launchPersistentContext(profileDir, {...})`
- **What exact folder is used?**
  - `agent/.session/profile` (see `const profileDir = path.join(agentDir, '.session', 'profile');`)
- **What does “warm” mean in this repo right now?**
  - Chromium persistent context is alive, user is authenticated, and the tee sheet for the target date is preloaded in the page.
- **Does any keepalive exist?**
  - No explicit keepalive or periodic refresh exists. If the browser context dies or auth expires, it is only re-initialized on demand.

---

## B) Release Detection

- **Where is waitForBookingRelease implemented?**
  - In `agent/index.js` as `async function waitForBookingRelease(page, timeoutMs = 2000)` (top of file, after imports).
- **What selector does it watch for booking links?**
  - Watches for: `a[href*="/bookings/book"]` (see `document.querySelector('a[href*="/bookings/book"]')`)
- **Does it click the first link, or match a time?**
  - It detects the first appearance of any booking link and returns the locator and slot time (if present in text). The click is executed on the first matching link, not by matching a specific time.

---

## C) Tee Sheet DOM Anchors

- **What selector proves the tee sheet is loaded?**
  - In `waitForTeeSheet` (both `agent/index.js` and `agent/warm_session.js`):
    - Any of the following:
      - `tr` (table row)
      - `text=/\b(?:0?\d|1\d|2[0-3]):[0-5]\d\b/` (time string)
      - `[data-tee-sheet]`, `.tee-sheet`, `#tee-sheet`, `[aria-label*="tee sheet" i]`, `section:has-text("tee sheet")`, `div:has-text("Booking")`
- **What selector represents a single tee-time row?**
  - `tr` (table row) is used as the anchor for a tee-time row.
- **What selector represents the booking link?**
  - `a[href*="/bookings/book"]` (used in both release detection and booking logic).

---

## D) /api/release-snipe Endpoint

- **Confirm if it exists right now**
  - Yes. Implemented in `agent/index.js` as `app.post('/api/release-snipe', ...)`.
- **Show the request body expected**
  - `{ username, password, targetDate, fireTimeUtc?, preferredTimes?, partySize? }`
- **Show what happens inside it step-by-step**
  1. Validates required fields (`username`, `password`, `targetDate`).
  2. Sets `fireTime` to `fireTimeUtc` or defaults to 1 minute from now.
  3. Sets `preferredTimes` to array or empty.
  4. Calls `warmSession.getWarmPage(targetDate, username, password)` to preload session/page.
  5. Waits until fire time if needed.
  6. Calls `runBooking` with `useReleaseObserver: true` (arms MutationObserver for release detection).
  7. Returns the booking result as JSON.

---

## E) Known Risks Before Wednesday Release

- **What can go cold?**
  - The warm session can die if the browser context closes, crashes, or if authentication expires. No keepalive exists.
- **What could delay click?**
  - If the session is not warm, or if the MutationObserver is not armed in time, or if the event loop is blocked by logging or other operations.
- **What parts still do scanning near release?**
  - If the release watcher times out (2s), the code falls back to a normal scan of preferred times, which involves DOM queries and slower logic.

---

## F) Next Required Upgrade

Based strictly on current code, the 3 most important upgrades remaining are:

1. **Keepalive warm survival**
   - Implement a periodic keepalive/refresh for the persistent context and authentication.
2. **Time-targeted MutationObserver click**
   - Ensure the MutationObserver is always armed and ready before release, and that click is executed with minimal delay.
3. **Final audit logging**
   - Add robust NDJSON or structured logging for all release-night actions, including timing, click delta, and errors.

---
