# Booking Flow Regressions

- Non-warm `/api/book-now` must create a browser, context, and page before login/navigation.
- Regression coverage: `automation/tests/book_now_endpoint.spec.ts`.
- Manual validation on 2026-04-27 confirmed no undefined `page`/`session` errors in live-click mode or safe mode.
- In `SAFE_MODE=true`, successful protection returns `result: "blocked-safe-mode"` with `blocked: true` and `notes: "SAFE_MODE prevented live booking click"`.
- As of 2026-04-28, `SAFE_MODE_ENABLED` is intentionally hard-disabled in `agent/index.js` for live operation. Confirm current runtime state with `GET /api/safe-mode`.
- Release-mode sniper must not click the first arbitrary booking link. It now uses direct BRS tee-sheet data as the capacity authority for multi-player release jobs, ranks real BRS slot rows nearest to ordered preferred times, and refuses partial bookings when the selected party will not fit.
- Release-speed path: release jobs skip pre-fire tee-sheet scraping, arm shortly before UK release time, poll BRS `/tee-sheet/data/1/YYYY/MM/DD` with authenticated concurrent requests, extract hashed booking URLs for real slot rows within the preferred-time window, then navigate directly to the first full-party candidate.
- A multi-player release job must not fall back from authenticated JSON to capacity-unknown HTML links. If the JSON shows no full-party candidate, the correct outcome is a logged no-candidate failure, not a partial booking attempt.
