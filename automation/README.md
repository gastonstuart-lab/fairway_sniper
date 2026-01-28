# Automation (Playwright) — quick start

This folder contains Playwright end-to-end tests used to exercise the Fairway Sniper flows.

## Prerequisites

- Node.js (LTS) and npm
- Playwright browsers (installed via `npx playwright install`)
- A working `automation/.env` file with non-secret settings (see example below)
- `state.json` (produced by running the `login.spec.ts` test in headed mode)

## Quick setup

```powershell
cd C:\Users\stuar\Projects\fairway_sniper\automation
npm install --no-audit --no-fund
npx playwright install
```

## Environment (.env) example

Create `automation/.env` with safe values (do NOT commit secrets):

```
FS_EMAIL=you@example.com
FS_PASSWORD=<REDACTED>
FS_TARGET_DATE=2025-10-25
FS_TARGET_TIMES=07:00,07:30,08:00
FS_DRY_RUN=true
FS_CLICK_WAITLIST=false
FS_TZ=Europe/London
FS_RELEASE_AT_LOCAL=2025-10-25T07:00:00
PW_FAST=1
```

## Create authenticated state.json

Run the login flow in headed mode to create `state.json` (do this once):

```powershell
npx playwright test tests/login.spec.ts --headed
```

## Run tests (dry-run recommended)

```powershell
$env:PW_FAST='1'; npx playwright test tests/sniper.spec.ts --project=chromium
# or run a single test headed for debugging
npx playwright test tests/book_slot.spec.ts --headed
```

## Snapshot and sharing

This repo contains `scripts/generate_snapshot.js` which will create `automation/snapshot.json` containing sanitized config, selected test files, and an optional truncated test run output.

Generate snapshot (no tests):

```powershell
node scripts/generate_snapshot.js
```

Generate snapshot and run tests (slower):

```powershell
node scripts/generate_snapshot.js --run-tests
```

## Notes

- Keep `state.json` and secrets out of source control.
- Use DRY_RUN (default) when iterating. Set `FS_DRY_RUN=false` only when you are ready to perform live bookings and have safety checks in place.
