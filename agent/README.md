# Fairway Sniper - BRS Golf Auto-Booking Agent

A complete automation system for booking golf tee times at Galgorm Castle (BRS Golf) with millisecond precision.

## 🏗️ System Architecture

### Components
- **Flutter App** (Web + Android): User interface for managing bookings
- **Node.js Agent**: Automation engine using Playwright
- **Firebase**: Backend (Firestore + Auth + Cloud Messaging)
- **Playwright**: Browser automation with precise timing

## 🚀 Quick Start

## How to run agent (Windows)

```bash
cd agent
npm install
npm run start
```

Test:

```powershell
Invoke-RestMethod http://localhost:3000/api/health
```

### Prerequisites
- Node.js 18+ 
- Firebase project with Firestore and Authentication enabled
- Service account credentials from Firebase

### 1. Firebase Setup

1. **Create Firebase Project**
   - Go to [Firebase Console](https://console.firebase.google.com/)
   - Create a new project or use existing
   - Enable **Firestore Database**
   - Enable **Authentication** (Email/Password)
   - Enable **Cloud Messaging**

2. **Generate Service Account Key**
   - Project Settings → Service Accounts
   - Click "Generate New Private Key"
   - Save the JSON file securely

3. **Deploy Firestore Rules**
   ```bash
   firebase deploy --only firestore:rules
   ```
   Or manually copy the contents of `firebase.rules` to the Firebase Console

4. **Connect Flutter App**
   - In Dreamflow, open the Firebase panel
   - Click "Connect to Firebase" 
   - Follow the guided setup to link your project

### 2. Agent Configuration

Set the following environment variables (or use a `.env` file):

```bash
# BRS Golf Credentials
CLUB_LOGIN_URL=https://members.brsgolf.com/galgorm/login
BRS_USERNAME=your_username_here
BRS_PASSWORD=your_password_here

# Firebase Configuration
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# Firebase Cloud Messaging (from Firebase Project Settings → Cloud Messaging)
FCM_SERVER_KEY=your_fcm_server_key_here

# Optional: Third-party CAPTCHA solver API key
CAPTCHA_API_KEY=

# Timezone (default: Europe/London)
TZ_LONDON=Europe/London
```

### 3. Install Agent Dependencies

```bash
cd agent
npm install
```

### 4. Run Test Mode

Test the agent without making actual bookings:

```bash
npm run test
# or
node index.js --dry-run
```

### 5. Production Deployment

#### Option A: Cloud Scheduler (Recommended)
Deploy to Google Cloud Run and trigger via Cloud Scheduler:

```bash
# Build Docker container
docker build -t fairway-sniper-agent .

# Deploy to Cloud Run (UK region for lowest latency)
gcloud run deploy fairway-sniper-agent \
  --image fairway-sniper-agent \
  --region europe-west2 \
  --set-env-vars CLUB_LOGIN_URL=...,BRS_USERNAME=...,BRS_PASSWORD=...
```

#### Option B: Local Cron
Schedule with cron to run 2 minutes before release time:

```bash
# Edit crontab
crontab -e

# Run at 19:18 every Tuesday (for 19:20 release)
18 19 * * 2 cd /path/to/agent && node index.js >> /var/log/fairway-sniper.log 2>&1
```

#### Option C: DreamFlow Scheduler
If using DreamFlow Pro, schedule directly in the platform.

## 🎯 How It Works

1. **Job Configuration**: User creates a booking job via the Flutter app
   - Club: Galgorm Castle
   - Release schedule: Tuesday at 19:20
   - Target day: Saturday
   - Preferred times: 11:04, 11:12, 11:20
   - Players: Up to 4 players

2. **Agent Execution**:
   - Starts 90 seconds before release time (19:18:30)
   - Launches headless browser
   - Logs into BRS Golf members portal
   - Navigates to booking page
   - Waits with millisecond precision
   - At exactly 19:20:00, attempts to book preferred times
   - Tries fallback times if primary unavailable

3. **Result Handling**:
   - Records attempt in Firestore `runs` collection
   - Sends push notification via FCM
   - Updates job status

## 📱 Flutter App Usage

### Login
- Create account or sign in with email/password
- Account is automatically synced with Firebase

### Create Booking Job
1. Tap the **+ New Booking Job** button
2. **Step 1**: Configure club and release schedule
   - Select club (Galgorm Castle)
   - Choose release day (Tuesday) and time (19:20)
   - Choose target play day (Saturday)
3. **Step 2**: Select preferred tee times (up to 3)
4. **Step 3**: Add players (1-4 players)
5. **Step 4**: Review and confirm

### Dashboard
- **Countdown**: Time until next booking attempt
- **Weather**: Saturday forecast for Galgorm
- **Active Jobs**: View and manage booking jobs
- **Recent Attempts**: See booking history

## ⚙️ Important Implementation Notes

### DOM Selectors Required

The agent contains **placeholder comments** where you need to add actual DOM selectors from the BRS Golf website:

1. **Login Page** (`index.js` line ~185):
   ```javascript
   // TODO: Replace with actual selectors
   await page.fill('input[name="username"]', username);
   await page.fill('input[name="password"]', password);
   await page.click('button[type="submit"]');
   ```

2. **Tee Time Selection** (`index.js` line ~240):
   ```javascript
   // TODO: Replace with actual selectors
   const timeSlot = await page.$(`button[data-time="${time}"]`);
   await timeSlot.click();
   await page.click('button.confirm-booking');
   ```

**To find the correct selectors:**
1. Visit the BRS Golf site in Chrome
2. Right-click → Inspect Element
3. Use the selector tool to identify elements
4. Update the agent code with actual selectors

### CAPTCHA Integration

The agent includes a **placeholder function** `maybeSolveCaptcha()` for third-party CAPTCHA solving:

```javascript
async function maybeSolveCaptcha(page) {
  // PLACEHOLDER ONLY.
  // Integrate your own CAPTCHA solver service here if needed
  // (e.g., 2Captcha, Anti-Captcha, etc.)
  return false;
}
```

**If the site uses CAPTCHA:**
1. Sign up for a CAPTCHA solver service
2. Add the API integration to this function
3. Set `CAPTCHA_API_KEY` environment variable

## 🔒 Security Best Practices

- **Never commit credentials** to version control
- Use environment variables or secret management
- Store Firebase private key securely
- Rotate passwords regularly
- Use Firebase security rules to restrict access
- Run agent in a trusted environment (UK region preferred)

## 📊 Database Structure

### Collection: `jobs`
```json
{
  "ownerUid": "user_firebase_uid",
  "club": "galgorm",
  "tz": "Europe/London",
  "release_day": "Tuesday",
  "release_time_local": "19:20",
  "target_day": "Saturday",
  "preferred_times": ["11:04", "11:12", "11:20"],
  "players": ["Player 1", "Player 2", "Player 3", "Player 4"],
  "status": "active",
  "next_fire_time_utc": Timestamp,
  "push_token": "FCM_TOKEN",
  "created_at": Timestamp,
  "updated_at": Timestamp
}
```

### Collection: `runs`
```json
{
  "jobId": "job_document_id",
  "started_utc": Timestamp,
  "finished_utc": Timestamp,
  "result": "success|fallback|failed|needs-human|error",
  "notes": "Completed in 243ms",
  "latency_ms": 243,
  "chosen_time": "11:04",
  "fallback_level": 0
}
```

## 🧪 Testing

1. **Dry Run Mode**: Test without actual booking
   ```bash
   npm run test
   ```

2. **Local Test**: Run agent locally before deployment
   ```bash
   node index.js
   ```

3. **Check Firestore**: Verify `runs` collection for results

4. **Test Notifications**: Ensure FCM token is saved and notifications arrive

## 🐛 Troubleshooting

### Agent not logging in
- Verify `BRS_USERNAME` and `BRS_PASSWORD` are correct
- Check DOM selectors match the actual site
- Enable `headless: false` temporarily to see browser

### Booking fails every time
- Verify tee time selector is correct
- Check if times are actually available
- Look at Firestore `runs` collection for error details

### No push notifications
- Verify `FCM_SERVER_KEY` is set
- Check that user granted notification permissions
- Ensure `push_token` is saved in the job document

### Timing is off
- Verify timezone is `Europe/London`
- Check system clock is accurate (use NTP)
- Consider network latency and adjust start time

## 📈 Performance Optimization

- **Deploy in UK region** to minimize latency to BRS Golf servers
- **Use SSD storage** for faster browser launch
- **Pre-warm connections** by logging in earlier
- **Monitor latency** in Firestore `runs` collection

## 🌐 Weather API

The app uses [Open-Meteo](https://open-meteo.com/) for weather forecasts:
- Free, no API key required
- Galgorm Castle coordinates: 54.8614°N, 6.2069°W
- Shows Saturday forecast on dashboard

## 📄 License

This software is provided for personal/family use only. Respect the terms of service of BRS Golf and do not abuse the automation system.

## 🆘 Support

For issues or questions:
1. Check Firestore `runs` collection for error logs
2. Review agent console output
3. Verify all environment variables are set correctly
4. Test with `--dry-run` mode first

---

**⛳ Happy golfing with Fairway Sniper!**
