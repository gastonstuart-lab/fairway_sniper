# Booking Flow Regressions

- Non-warm `/api/book-now` must create a browser, context, and page before login/navigation.
- Regression coverage: `automation/tests/book_now_endpoint.spec.ts`.
- Manual validation on 2026-04-27 confirmed no undefined `page`/`session` errors in live-click mode or safe mode.
- In `SAFE_MODE=true`, successful protection returns `result: "blocked-safe-mode"` with `blocked: true` and `notes: "SAFE_MODE prevented live booking click"`.
- As of 2026-04-28, `SAFE_MODE_ENABLED` is intentionally hard-disabled in `agent/index.js` for live operation. Confirm current runtime state with `GET /api/safe-mode`.
- Release-mode sniper must not click the first arbitrary booking link. It now watches for ordered preferred/fallback times only, parses time from BRS booking hrefs, and retries remaining preferred times if the first release click does not confirm.
