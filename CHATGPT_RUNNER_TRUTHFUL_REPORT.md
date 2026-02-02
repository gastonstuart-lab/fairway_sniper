# Fairway Sniper — Runner Truthfulness Fix + Test Outcome (Feb 1, 2026)

This file summarizes the latest changes, run behavior, and the “truthful” booking verification fix request.

---

## ✅ Recent Successful Run (Pipeline Verified)

**Job ID:** `2MYmv9UrUzANJWP6ykly`

**Runner log highlights:**
- Job detected and claimed
- Fire time resolved and scheduled
- Warmed correct tee sheet date: `/2026/02/02`
- runBooking executed
- Release watcher detected booking link and clicked
- Run finished with **booked_time=release**

**Firestore final state (jobs/<jobId>):**
- status: `finished`
- state: `finished`
- result: `success`
- booked_time: `release`
- error_message: `null`
- finished_at: timestamp

**But:** No booking appeared on BRS. Click-only success is not enough.

---

## ✅ Dry-Run Validation (No Booking Created)

Three release-mode dry runs executed with `dry_run=true` (Create Booking skipped) to measure click timing without creating bookings.

**Jobs:**
- HL9PQ8Emyle7ClZV9vLL (08:20)
- hceeVdyQjl2p03XAVtxB (11:40)
- jLT2fM7dGOLQrJY8SRz7 (12:20)

**Click delta results (ms):** 1011, 907, 922

**Stats:** min 907, median 922, avg 947, max 1011

**Proposed target threshold:** $<900\,ms$ click delta for release detection → click.

**New metric captured:** `release_detect_delta_ms` (time from target fire to booking link appearing) saved to job docs for future runs.

**Sample (dry-run):** Job Zlbnttl8ovbLpC0QsaWG → `release_detect_delta_ms=284`, `click_delta_ms=1124`.

**Additional samples (dry-run):**
- 34JudOFGZWaiQSpf1rR1 → `release_detect_delta_ms=303`, `click_delta_ms=1035`
- jVB5BBJ1tHBcZPyFkPAN → `release_detect_delta_ms=0`, `click_delta_ms=1038`

**Release detect stats (ms):** min 0, median 284, avg 196, max 303

**Latest dry-run (post-stability):** CKVNRBb98W3KeEz3XsSk → `release_detect_delta_ms=0`, `click_delta_ms=2003` (click delta spike).

---

## Root cause
The runner marks success after clicking a booking link without confirming that the booking was actually completed. This can lead to false positives when:
- click delta is late
- confirmation page did not load
- booking form not fully completed

---

## Required fix (truthful runner)

### 1) Where success is currently set
In `agent/index.js`, release watcher path:
- `bookedTime = 'release'`
- `fsFinishRun(... result: 'success' ...)`
- return `{ success: true, result: 'success', bookedTime }`

`tryBookTime()` also returns `booked=true` based only on confirm click.

### 2) Required strict verification
After click (and player fill + confirm), success only if **any** confirmation signal is detected:

- **URL change**: `/bookings/confirm` or `/booking/success`
- **Confirmation text**: “Booking confirmed”, “Reservation Complete”, etc.
- **Row state change**: target time row shows booked/unavailable and no Book button
- Optional: response/network confirmation

If no confirmation within 8–12s:
- mark result = `click_only`
- mark job status/state = `error`
- error_message = `clicked but no confirmation`

### 3) Persist diagnostics on failure
Save into Firestore:
- click_delta_ms
- verification_url
- verification_signal
- booking_links_count_after_click
- snapshot_path (HTML snapshot)

---

## Suggested patch (summary)
Add verification helper + HTML snapshot and update:

- Release watcher path: click → verify → success_confirmed or click_only
- tryBookTime(): verify after confirm and only set booked when verified
- fsUpdateJob: error on click_only

---

## Updated test job configuration (correct target date)
The previous warm used `/2026/02/08` because `target_play_date` was set to now+7 days.

Test job should explicitly set:

- `target_play_date = 2026-02-02`
- `fire_time_utc = now + 2 minutes`
- preferred_times = ["08:20"]

After patch, warm should show:
```
[WARM] loading tee sheet https://members.brsgolf.com/galgorm/tee-sheet/1/2026/02/02
```

---

## Files involved
- `agent/index.js`
- `agent/test-create-sniper-job.js`
- `agent/output/*.html` (snapshot on failure)

---

## Current status
✅ Runner claims, warms, schedules, and executes.
⚠️ Runner reports success without confirmation. Must add verification to make results truthful.

---

End of report.
