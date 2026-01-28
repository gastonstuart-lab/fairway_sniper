# Fairway Sniper - Status Report

## ✅ What's Working Now

### 1. Agent Setup ✅

- BRS Golf credentials configured in `.env`
- Login tested and working
- Authentication saved to `state.json`

### 2. Booking Logic ✅

- Ported working selectors from automation tests to agent
- Can detect Book buttons on tee sheet
- Handles iframe detection
- Has modal flow fallback
- Retry logic implemented

### 3. HTTP Server ✅

- Starts reliably on port 3000
- Health check working
- Fetch tee times endpoint ready

## 🎯 How the App Works (Booking Flow)

### The 7-Day Release Window

- **Today**: Monday, November 25
- **Booking Window**: 7 days ahead
- **Next Release**: Tuesday, November 26 at 7:20 PM
- **Target Date**: Saturday, November 30 (opens Tuesday at 7:20 PM)

### The Booking Process

1. **You create a job** (via Flutter app or directly in Firestore):

   ```
   Release: Tuesday 7:20 PM
   Target Date: Saturday Nov 30
   Preferred Times: 11:04, 11:12, 11:20
   ```

2. **Agent runs automatically**:
   - Starts 90 seconds before 7:20 PM (at 7:18:30 PM)
   - Logs into BRS Golf
   - Pre-navigates to the tee sheet
   - Waits with millisecond precision
   - At **exactly 7:20:00 PM**, starts polling for Book buttons
   - Clicks the first available preferred time
   - Records result and sends notification

## 🚀 Next Steps

### Option A: Test with Firebase (Full Integration)

Run the setup wizard again and add Firebase credentials:

```powershell
cd agent
.\setup.ps1
# This time, answer 'y' to Firebase configuration
```

Then:

1. Start the Flutter app: `cd .. && flutter run -d chrome`
2. Create a booking job in the app
3. Agent will automatically detect and execute it

### Option B: Manual Test (No Firebase)

Create a test job directly:

```powershell
cd automation

# Set these environment variables for your test
$env:FS_DRY_RUN = 'true'  # Won't actually book
$env:FS_RELEASE_AT_LOCAL = '2025-11-26T19:20:00'  # Tuesday 7:20 PM
$env:FS_TARGET_DATE = '2025-11-30'  # Saturday
$env:FS_TARGET_TIMES = '11:04,11:12,11:20'  # Your preferred times

# Run the sniper test (it will wait until the release time)
npx playwright test sniper.spec.ts --headed
```

**For a real booking**: Remove `$env:FS_DRY_RUN = 'true'`

## 📋 Configuration Reference

### Your Current .env

```
BRS_USERNAME=12390624
BRS_PASSWORD=****** (set)
FIREBASE_PROJECT_ID= (not set - optional)
```

### Typical Booking Schedule

- **Tuesday 7:20 PM** → Opens Saturday bookings
- **Booking window**: Exactly 7 days ahead
- **Agent timing**: Starts 90 seconds early for precision

## 🔧 Useful Commands

### Test Login

```powershell
cd automation
npx playwright test login.spec.ts --headed
```

### Test Booking Detection

```powershell
cd automation
.\test-booking-logic.ps1
```

### Start Agent HTTP Server

```powershell
cd agent
.\start-agent.ps1
```

### Run Full Booking Test

```powershell
cd automation
$env:FS_DRY_RUN = 'true'
$env:FS_RELEASE_AT_LOCAL = '2025-11-26T19:20:00'
$env:FS_TARGET_DATE = '2025-11-30'
$env:FS_TARGET_TIMES = '08:00,09:00,10:00'
npx playwright test sniper.spec.ts --headed
```

## ⚠️ Important Notes

1. **DRY_RUN Mode**: Always test with `FS_DRY_RUN=true` first to avoid accidentally booking
2. **Timing**: The agent uses precise timing - it will literally wait until 7:20:00.000 PM
3. **Preferred Times**: List multiple times in order of preference
4. **7-Day Window**: You can only book dates that are exactly 7 days ahead (when they open)

## 🎉 Summary

**Your app is ready!** The core booking logic works and can detect Book buttons. You can now:

1. **Test manually** using the sniper test with environment variables
2. **Set up Firebase** to use the full Flutter app integration
3. **Schedule real bookings** for Tuesday 7:20 PM to snipe Saturday slots

The app will automatically book your preferred tee times the moment they're released!
