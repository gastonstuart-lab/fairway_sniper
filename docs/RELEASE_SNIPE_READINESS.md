# Release Snipe Readiness Pack

## 1) Executive Summary (Current State)

**What works now:**
- Endpoints: `/api/warm-status`, `/api/release-snipe`, and others are registered and functional.
- Successful booking flow: Automated login, tee sheet preload, and booking confirmation are working.
- Warm profile: Persistent Playwright context is created and reused (`agent/.session/profile`).
- Preload: Tee sheet is preloaded before release time, DOM readiness is confirmed by row/time selectors.
- Release watcher logic: In-page MutationObserver detects booking link appearance and triggers instant click (<200ms possible).

**Primary goal:**
- Achieve sub-200ms click on booking link at exact release time (UK 19:20), with robust fallback and logging.

**Remaining tasks:**
- Warm session survival/keepalive for long periods.
- Harden MutationObserver and error handling.
- Finalize `/api/release-snipe` endpoint for production.
- Add NDJSON audit logging and notification hooks.
- Scheduling/notifications for future jobs (out of current scope).

---

## 2) Repo Map (Key Files + Ownership)

- `agent/index.js`: Main Express server, endpoint registration, booking logic, release watcher, and job system.
- `agent/warm_session.js`: Persistent Playwright context, warm session management, tee sheet preload, login caching.
- `agent/booking-logic.js` (if present): Booking flow helpers (form filling, confirmation, player selection).
- `agent/logger.js`: Logging utilities (if present).
- `agent/rateLimit.js`: Rate limiting (if present).
- `automation/`: Playwright integration tests and config.
- `lib/`: Flutter app (UI, not directly involved in agent logic).
- `agent/.session/profile/`: Persistent Chromium user data for warm session.
- `agent/README.md`, `README.md`: Project and agent documentation.

---

## 3) API Surface (All Endpoints)

- **GET /api/warm-status**
  - Input: None
  - Output: `{ warm, authenticated, teeSheetLoaded, targetDate, lastError }`
  - Location: `agent/index.js`, handler: `app.get('/api/warm-status', ...)`

- **POST /api/release-snipe**
  - Input: `{ username, password, targetDate, fireTimeUtc?, preferredTimes?, partySize? }`
  - Output: Booking result object (success, notes, timing, etc.)
  - Location: `agent/index.js`, handler: `app.post('/api/release-snipe', ...)`

- **Other endpoints** (from README and code):
  - `GET /api/health`: Health check
  - `POST /api/fetch-tee-times`: Fetch single day
  - `POST /api/fetch-tee-times-range`: Fetch 7-day range
  - `GET /api/playwright-check`: Playwright status
  - (See `agent/index.js` and `README.md` for more)

---

## 4) Warm Session Details (CRITICAL)

- Persistent context is created via `chromium.launchPersistentContext(profileDir, ...)` in `agent/warm_session.js`.
- Profile directory: `agent/.session/profile/`
- "Warm" means: (1) Chromium context is alive, (2) user is logged in, (3) tee sheet is preloaded for target date.
- Session is kept alive by reusing the context/page; no explicit keepalive yet.
- Warm session can die if: browser closes, context is destroyed, auth expires, or page navigation fails.
- Not logged in: Absence of logout/tee sheet links, or failed auth check in `isAuthenticated()`.

---

## 5) Tee Sheet Preload Details

- Preload waits for any of:
  - `tr` (table row)
  - `text=/\b(?:0?\d|1\d|2[0-3]):[0-5]\d\b/` (time string)
  - `[data-tee-sheet]`, `.tee-sheet`, `#tee-sheet`, or similar containers
- DOM is "ready" when any of the above selectors are visible.
- No caching of row handles or selectors; only page state is reused.
- Near release time: DOM polling is avoided; only MutationObserver is used for release detection.

---

## 6) Release Detection Logic (Current)

- `spinUntil(targetFireTime)`: Busy-waits until the exact release time.
- `waitForBookingRelease(page, 2000)`: In-page MutationObserver watches for first `a[href*="/bookings/book"]`.
- On detection: Click is executed instantly, delta is logged, and warning if >200ms.
- Fallback: If not detected in 2s, normal preferredTimes scan is performed.
- All logic in `agent/index.js` and `agent/warm_session.js`.

---

## 7) Release-Time Semantics (NO CONFUSION)

- **Target date**: The date for which the tee time is being booked.
- **Pickup time**: The desired tee time (e.g., 08:00, 08:10, ...).
- **Release time rule**: (NEEDED INPUT) e.g., "5 days before target date at 19:20 UK time".

**Time Computation Checklist:**
- `computeNextFireUTC()` in `agent/index.js` computes next release window given day/time and timezone.
- NEEDED INPUT: Exact release schedule rule and timezone for production.

---

## 8) Booking Confirmation Proof

- Success is indicated by:
  - Text match: `Booking confirmed`, `Booking Successful`, `Reservation Complete`, etc.
  - Fallback: Bookings list page heading.
- Implemented in: `fillPlayersAndConfirm()` in `agent/index.js`.
- No screenshots or HTML dumps are created by default.
- Retries: Not automatic; fallback is to try next preferred time if booking fails.

---

## 9) Performance Risk Audit (Release Night)

**Risks:**
- Cold navigation or login at release (if warm session dies)
- Late DOM queries or polling after release
- Event loop blocking from excessive logging
- Playwright "stale element" if DOM changes after detection
- Auth expiry or session timeout

**Mitigations:**
- Ensure warm session is alive and authenticated before release
- Use only MutationObserver for release detection (no polling)
- Minimize logging in critical path
- Add keepalive/refresh logic for warm session
- Harden error handling for Playwright context/page

---

## 10) Exact Next Steps (Implementation Plan)

A) **WarmManager singleton + keepalive**
   - Add to `agent/warm_session.js` and import in `agent/index.js`.

B) **In-page MutationObserver trigger**
   - Already implemented in `waitForBookingRelease()` and `waitForBookingReleaseObserver()`.

C) **/api/release-snipe endpoint**
   - Finalize handler in `agent/index.js`.

D) **NDJSON audit logging**
   - Add to `agent/logger.js` or directly in `agent/index.js`.

E) **Minimal simulated release test**
   - Add test script in `agent/test-sniper-4min.ps1` or similar.

---

## 11) NEEDED INPUT (from the user)

- [ ] UK release time exact (e.g., 19:20, 5 days before? Which days?)
- [ ] Target date (format, selection rules)
- [ ] Acceptable pickup time window (how many minutes, which slots)
- [ ] Party size rules (max/min, default)
- [ ] Selectors for tee sheet root/row/booking link (if club changes UI)
- [ ] Success confirmation selector/behavior (if club changes UI)

---

# END OF PACK
