# Fairway Sniper - Automated BRS Golf Tee Time Booking

## Overview

Fairway Sniper automates booking tee times on BRS Golf club systems (members.brsgolf.com). It supports two booking modes:

- **Sniper Mode**: Pre-select up to 3 times; agent fires at release time (e.g., Tuesday 7:20 PM for next Saturday).
- **Normal Mode**: Book immediately from currently available times; optionally sweep next 7 days to find best slot.

## Architecture

- **Flutter App** (`lib/`): Mobile/web UI for job creation, login, dashboard.
- **Agent** (`agent/`): Node.js HTTP server providing scraping endpoints and scheduling automation.
- **Automation** (`automation/`): Playwright integration tests for booking logic validation.
- **Firebase**: Firestore for job storage; Firebase Auth for user accounts; FCM for push notifications.

## Quick Start

### Prerequisites

- Node.js 18+ (for agent)
- Flutter 3.x (for app)
- Chrome/Chromium (for Playwright automation)
- Firebase project with Firestore, Auth, and FCM enabled

### Setup

1. **Clone & Install**

   ```powershell
   cd C:\path\to\fairway_sniper
   cd agent
   npm install
   npx playwright install chromium
   cd ..\automation
   npm install
   npx playwright install
   cd ..
   flutter pub get
   ```

2. **Configure Environment**
   Create `agent/.env`:

   ```env
   BRS_USERNAME=your_brs_username
   BRS_PASSWORD=your_brs_password
   CLUB_LOGIN_URL=https://members.brsgolf.com/galgorm/login
   FIREBASE_PROJECT_ID=your-firebase-project
   FIREBASE_CLIENT_EMAIL=firebase-adminsdk@...iam.gserviceaccount.com
   FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
   FCM_SERVER_KEY=your_fcm_server_key
   PORT=3000
   AGENT_RUN_MAIN=false
   AGENT_HEADLESS=true
   AGENT_DEBUG=false
   PUBLISH_AVAILABLE_TIMES=false
   ```

3. **Firebase Setup**
   - Download `google-services.json` → `android/app/`
   - Generate `lib/firebase_options.dart` (run `flutterfire configure`)

### Running

#### Agent Server

```powershell
cd agent
node index.js
```

Endpoints:

- Health: `GET http://localhost:3000/api/health`
- Fetch Single Day: `POST http://localhost:3000/api/fetch-tee-times`
- Fetch 7-Day Range: `POST http://localhost:3000/api/fetch-tee-times-range`
- Playwright Check: `GET http://localhost:3000/api/playwright-check`

#### Flutter App

## Release Snipe

See [docs/RELEASE_SNIPE_READINESS.md](docs/RELEASE_SNIPE_READINESS.md) for a complete, repo-grounded readiness pack and implementation plan for the /api/release-snipe endpoint and sub-200ms release-night booking.

```powershell
flutter run -d chrome
# or
flutter run -d <android_device_id>
```

#### Automation Tests

```powershell
cd automation
npx playwright test tests/login.spec.ts --headed
npx playwright test tests/range_endpoint.spec.ts
```

## Features

### Normal Mode 7-Day Sweep

- Endpoint: `/api/fetch-tee-times-range`
- Request:
  ```json
  {
    "startDate": "2025-11-25T00:00:00.000Z",
    "days": 7,
    "username": "your_brs_user",
    "password": "your_brs_pass",
    "reuseBrowser": true
  }
  ```
- Response:
  ```json
  {
    "success": true,
    "mode": "single-session",
    "days": [
      { "date": "2025-11-25", "times": ["08:00", "09:10", "14:30"] },
      { "date": "2025-11-26", "times": ["10:00", "11:20"], "error": null }
    ],
    "performance": {
      "total_ms": 12450,
      "day_metrics": [
        { "date": "2025-11-25", "times_count": 3, "latency_ms": 1800 },
        { "date": "2025-11-26", "times_count": 2, "latency_ms": 1750 }
      ]
    }
  }
  ```
- **Single-Session Mode** (default `reuseBrowser=true`): Opens one browser, logs in once, iterates dates. ~7-15s for 7 days.
- **Multi-Launch Mode** (`reuseBrowser=false`): Launches new browser per day (slower, for debugging).

### Security

- Credentials masked in logs: `us***` instead of full username.
- Set `AGENT_DEBUG=true` to enable verbose logging (includes full credentials—use only in dev).
- Passwords stored in Firestore as plaintext currently; consider encrypting before production.

### Performance

- **Single-day fetch**: ~2-4s
- **7-day range (single-session)**: ~10-20s depending on network/server response
- Each day adds ~500ms pacing delay to avoid rate limits.
- Metrics returned in `performance` object for monitoring.

## Development

### Code Structure

- `agent/index.js`: Main server + scraping logic
- `lib/screens/new_job_wizard.dart`: Job creation wizard (Sniper/Normal mode selection)
- `lib/models/booking_job.dart`: Job data model
- `automation/tests/`: Playwright integration tests

### Adding New Clubs

Edit `agent/index.js` → update `CONFIG.CLUB_LOGIN_URL` and tee-sheet URL pattern (line ~900).

### Debugging

- Set `AGENT_DEBUG=true` in `.env` to enable trace logging.
- Set `headed=true` in API request body to watch browser automation.
- Playwright traces saved to `agent/output/` when debug enabled.

### Testing

```powershell
# Login test
cd automation
npx playwright test tests/login.spec.ts --headed

# Range endpoint integration test (spawns agent on port 3100)
npx playwright test tests/range_endpoint.spec.ts

# Full booking flow (requires valid credentials)
npx playwright test tests/book_slot.spec.ts --headed
```

## Deployment

### Agent (Server)

- Deploy as Node service on cloud (Railway, Heroku, GCP Cloud Run, AWS ECS, etc.)
- Set env vars via platform config
- Ensure Playwright dependencies installed (`npx playwright install --with-deps chromium`)
- Recommend `AGENT_HEADLESS=true` in production

### Flutter App

- **Web**: `flutter build web` → deploy to Firebase Hosting / Vercel / Netlify
- **Android**: `flutter build apk --release` → distribute APK or publish to Play Store
- **iOS**: `flutter build ios --release` → publish to App Store

## Roadmap

- [x] Dual-mode booking (Sniper + Normal)
- [x] Multi-day availability sweep
- [x] Performance metrics
- [x] Integration tests
- [x] Security: credential masking
- [ ] Firestore caching for multi-day results
- [ ] UI: expandable error display per day
- [ ] Advanced scheduling: delayed Normal Mode execution
- [ ] Multi-club support UI
- [ ] Email/SMS notifications (beyond FCM push)

## Troubleshooting

### Agent exits with code 1

- **Cause**: Port 3000 already in use.
- **Fix**: Kill process or set `PORT=3001` in `.env`.

### No times returned

- **Cause**: Credentials invalid, club site down, or no bookable slots.
- **Fix**: Verify credentials; check site manually; inspect agent logs with `AGENT_DEBUG=true`.

### Flutter build errors

- **Cause**: Missing `firebase_options.dart` or `google-services.json`.
- **Fix**: Run `flutterfire configure` and download service files from Firebase console.

### Playwright ENOENT errors in tests

- **Cause**: Playwright browsers not installed.
- **Fix**: `cd automation && npx playwright install`

## License

See LICENSE file.

## Contributing

Pull requests welcome. For major changes, open an issue first.

## Support

- GitHub Issues: [gastonstuart-lab/fairway_sniper](https://github.com/gastonstuart-lab/fairway_sniper/issues)
- Email: (add support email if available)
