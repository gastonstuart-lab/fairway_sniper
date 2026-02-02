# Fairway Sniper - Final Completion Plan (Updated)

## Current State (as of Feb 1, 2026)
- Form inspection completed and documented.
- Player selection + confirm logic implemented in agent.
- /api/book-now and /api/snipe endpoints wired to booking flow.
- Live run executed, but no successful booking verified (time had no availability).

---

## 1. Live Booking Verification (CRITICAL)
**Goal:** Confirm a real booking is created when a slot is available.

Tasks:
- Identify a target time with open slots (ideally 3+ slots) for live testing.
- Run booking via /api/book-now with 1–3 players (IDs or names).
- Verify booking appears in BRS account and confirmation text is detected.

Acceptance Criteria:
- API response returns success and booked true.
- Confirmation text captured (or bookings page detected).
- Booking visible in BRS “My Bookings.”

---

## 2. Sniper Scheduler (HIGH)
**Goal:** Scheduled jobs run automatically without manual trigger.

Tasks:
- Implement a background runner (PM2/cron/Cloud Functions) to poll Firestore jobs.
- Ensure release-time precision + fallback scan behavior are stable.
- Add job status transitions (waiting → running → completed/failed).

Acceptance Criteria:
- A scheduled job triggers at the correct release time.
- Booking attempt logs and Firestore run record are created.

---

## 3. Error Handling & Edge Cases (MEDIUM)
**Goal:** Fail gracefully with actionable errors and retries.

Tasks:
- Standardize booking error codes (slot unavailable, confirm not found, timeout).
- Add retries for navigation + transient form failures.
- Add explicit handling for openSlots < players requested.

Acceptance Criteria:
- Users receive a clear error reason in API response.
- Logs include structured notes for troubleshooting.

---

## 4. Mobile Testing & UI Polish (MEDIUM)
**Goal:** Mobile UX is reliable.

Tasks:
- Test Flutter app on Android + iOS devices.
- Fix layout overflows and tap targets.
- Verify booking flow and dashboard on mobile.

Acceptance Criteria:
- No blocking UX issues on common device sizes.

---

## 5. Production Readiness (LOW)
**Goal:** Ship with reliable ops + security.

Tasks:
- Confirm Firebase Admin credentials on server.
- Harden Firestore rules + add monitoring.
- Document deployment + runbook.

Acceptance Criteria:
- Agent runs persistently in production environment.
- Security rules pass smoke tests.

---

## Immediate Next Steps (Order)
1. Complete a live booking with a known available slot.
2. If success: run the same flow via Flutter UI (Normal mode).
3. Implement sniper scheduler runner and test a scheduled job.
4. Do mobile QA + polish.
5. Production hardening and beta launch.

---

This plan will be updated as each step is completed.