# Player Data Flow (Simplified)

## Goal

Provide a stable list of player names that the app can present for selection when preparing a booking. The list is scraped once, cached, and refreshed manually if needed.

## Core Principles

- Single navigation sequence: Login -> Tee Sheet -> First Book -> Booking Form.
- Avoid per-slot scraping (expensive & fragile).
- Prefer select option extraction; fallback to simple regex if no selects present.
- Cache results to `automation/players.json`.

## Endpoints

- `GET /api/players` returns cached list `{ success, scrapedAt, count, players[] }`.
- `POST /api/players/refresh` performs a scrape and rewrites `players.json`.
- `GET /api/players/status` lightweight presence + count check.
- `POST /api/players/upload` manual override (CSV or JSON) of the cache.

## Refresh Workflow

1. Client calls `POST /api/players/refresh` with body:
   ```json
   { "username": "GUIxxxx", "password": "secret", "club": "galgorm" }
   ```
2. Agent launches Playwright:
   - Logs in using provided credentials (robust selectors reused from tee time scraping).
   - Navigates to today tee sheet.
   - Clicks first Book button.
   - Extracts names from any `<select>` elements (filters placeholders).
   - Falls back to regex matching `Lastname, Firstname` if no selects.
3. Cached file: `automation/players.json`:
   ```json
   {
     "scrapedAt": "2025-11-26T09:00:00.000Z",
     "count": 120,
     "players": ["Doe, John", "Smith, Anna", "Brown, Liam"]
   }
   ```

## Frontend Usage (Flutter)

- On app startup:
  - Call `GET /api/players`. If empty, prompt user to refresh.
- Provide a "Refresh Players" button that calls `POST /api/players/refresh`.
- Store list locally (e.g., persisted via Hive/shared prefs) to avoid repeat network calls.
- Offer an advanced screen to manually upload player list (developers/admin only) using `/api/players/upload`.

## Future Improvements

- Detect underlying network JSON endpoint and replace DOM-based scrape.
- Add optional CSV upload endpoint for manual override.
- Associate internal IDs if exposed (currently we use display text only).
- Consolidate manual upload UI and show last update/source from `/api/players/status`.

## Notes

- The older per-slot scraping logic (`scrapePlayerNamesForSlot`) has been removed.
- `/api/brs/fetch-player-directory` remains for diagnostic exploration; prefer `/api/players/refresh` for production.
