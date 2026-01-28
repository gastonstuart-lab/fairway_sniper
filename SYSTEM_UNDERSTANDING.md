# System Architecture & Complete Flow

## The Flow (End-to-End)

### 1. Flutter App (Normal Mode)
- User inputs: BRS credentials, target date, preferred times, player names
- **Calls**: `POST http://localhost:3000/api/snipe`
- **Payload**:
  ```json
  {
    "username": "12390624",
    "password": "cantona7777",
    "targetDate": "2026-01-29",
    "preferredTimes": ["08:40", "09:00"],
    "players": ["Stuart Campbell", "John Doe"],
    "checkOnly": false
  }
  ```

### 2. Agent Server (agent/index.js)
- **Endpoint**: `POST /api/snipe`
- **Logic**:
  1. Calls `fetchAvailableTeeTimesFromBRS()` to scan tee sheet
  2. If `checkOnly=true`: return available slots only
  3. If `checkOnly=false` and slots available: call `runBooking()`
  
### 3. runBooking() Function (Line 492)
- Launches Chromium browser
- Calls `loginToBRS()` 
- Calls `navigateToTeeSheet()`
- Waits until target fire time
- **Calls `tryBookTime()` for each preferred time** ← THIS IS KEY

### 4. tryBookTime() Function (Line 293) - WHERE WE ARE NOW
**CURRENT ISSUE**: This function needs to:
1. ✅ Find the booking button for the time (WORKS - we scan table rows)
2. ✅ Click "BOOK NOW" (WORKS)
3. ❌ Fill players in the booking form (BROKEN - tried Select2, didn't work)
4. ❌ Click confirm button (BROKEN - button not found or success not verified)

## What's Working vs Broken

### ✅ WORKING (Proven in automation/tests/book_production.spec.ts)
- **Login** via `ensureLoggedIn()`
- **Navigate to tee sheet** via `navigateToTeeSheet()` 
- **Scan for bookable times** via `scanForBookableTimes()` - finds matching time row
- **Click booking button** - we do this successfully

### ❌ BROKEN (Currently failing)
- **Player selection** - currently trying Select2 selectors, but they're not working
- **Confirmation** - button not found or not clicked properly
- **Success verification** - currently just assumes it worked, doesn't verify

## The Solution

The test suite (`automation/tests/book_production.spec.ts`) has **PROVEN WORKING** code for:
- `fillPlayers()` - Uses getByLabel, getByRole('combobox'), and text input fallbacks
- `autoConfirm()` - Uses getByRole('button') with regex and checks for success messages
- `verifyBookingSuccess()` - Checks for specific success message patterns

**What we did wrong**: We tried to invent Select2-specific selectors instead of using the working code that already handles multiple form types.

## Current Code Status

**agent/index.js tryBookTime()** (Line 340-398):
- Just updated to use `fillPlayers()` and `autoConfirm()` from selectors.ts
- But this mixes TypeScript logic with JavaScript - they're not the same functions!
- **CRITICAL**: The agent is Node.js, NOT Playwright test runner
- Agent uses Playwright's `page` locator API (JavaScript)
- Tests use Playwright's Locator API with TypeScript helpers

## Next Step

**DO NOT copy TypeScript test code directly to Node.js agent**

Instead, rewrite the agent's booking logic to match the TEST LOGIC but in JavaScript:
1. Use Playwright's locator methods properly (JavaScript syntax)
2. Use same selector patterns as the tests
3. Use same success verification approach
4. Actually wait for and check success messages

## Key Insight

The issue is NOT the selectors - it's that we were trying Select2-specific stuff when the real form probably uses:
- Standard HTML `<select>` or text `<input>` 
- Or Material Design combobox
- Or Role-based selectors

The test code already tries ALL of these. We just need to translate that to JavaScript.
