# ACTION PLAN: Get Your First Real Booking Working
**Objective:** Complete end-to-end booking flow (Normal mode)  
**Timeline:** 3-4 hours of focused work  
**Success Metric:** See booking appear in BRS account after clicking "Book Now"

---

## STEP 1: Inspect the Real BRS Booking Form (30 minutes)

### What You Need to Know
Before we can automate filling the form, we need to see exactly what it looks like.

### Instructions
1. **In your browser (Chrome):**
   - Go to https://members.brsgolf.com/galgorm/login
   - Log in with: `12390624 / cantona7777`
   - Navigate to tee sheet for any future date
   - Click on ANY available tee time slot

2. **Inspect the Booking Form:**
   - Right-click on the form → "Inspect" (or F12)
   - Look for:
     - What's the form tag structure?
     - What are the input field names for Players?
     - Are they `<select>` dropdowns or text inputs?
     - Do they have `id`, `name`, or `data-*` attributes?
     - What's the confirm button text/selector?

3. **Save This Information:**
   - Take a screenshot of the form
   - Copy the HTML source of the form section
   - Note any JavaScript behavior (Select2 dropdowns?)

### Why This Matters
Your current code guesses at selectors like:
```javascript
const slot = page.locator(`a[href*="/bookings/book/${hhmm}"]`);
const btn = page.locator('button:has-text("Confirm")');
```

If the actual form is different, the booking will fail silently.

---

## STEP 2: Update `tryBookTime()` to Fill Player Form

### Current Code (Incomplete)
```javascript
async function tryBookTime(page, time) {
  // Clicks time, then clicks confirm
  // MISSING: Player form filling
}
```

### What Needs to Change
After clicking the time slot, the booking form appears. You need to:

1. **Wait for form to load** (500ms should be enough)
2. **Fill Player 2** with first selected player
3. **Fill Player 3** with second selected player (if exists)
4. **Fill Player 4** with third selected player (if exists)
5. **Click confirm**

### New Implementation Template

```javascript
async function tryBookTime(page, time, players = []) {
  // 1. Find and click the time slot
  const hhmm = time.replace(/[^0-9]/g, '');
  const slot = page.locator(`a[href*="/bookings/book/${hhmm}"]`).first();
  
  if (!slot || (await slot.count()) === 0) {
    console.log(`⚠️ No slot found for ${time}`);
    return false;
  }
  
  await slot.click({ timeout: 8000 });
  await page.waitForTimeout(800); // Wait for form to appear
  
  // 2. Fill player dropdowns
  // IMPORTANT: Adjust selectors based on what you found in Step 1
  const playerSelectors = [
    // Player 2
    'select[name="player_2"], select[id*="player_2"], select#player-2',
    // Player 3
    'select[name="player_3"], select[id*="player_3"], select#player-3',
    // Player 4
    'select[name="player_4"], select[id*="player_4"], select#player-4',
  ];
  
  // Fill players in order
  for (let i = 0; i < players.length && i < 3; i++) {
    const playerName = players[i];
    console.log(`   Filling player ${i + 2}: ${playerName}`);
    
    // Try to find and fill the select
    const select = page.locator(playerSelectors[i]).first();
    if (await select.count() > 0) {
      await select.selectOption({ label: playerName }).catch(err => {
        console.warn(`Could not select "${playerName}" in player ${i+2}:`, err.message);
      });
    }
  }
  
  // 3. Click confirm/submit
  const confirmSelectors = [
    'button:has-text("Confirm")',
    'button:has-text("Book Now")',
    'button:has-text("Submit")',
    'button[type="submit"]',
  ];
  
  for (const sel of confirmSelectors) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click({ timeout: 8000 });
      await page.waitForTimeout(500);
      console.log(`✅ Clicked confirm for ${time} with players: ${players.join(', ')}`);
      return true;
    }
  }
  
  console.log(`⚠️ No confirm button found`);
  return false;
}
```

### Update `runBooking()` to Pass Players

Find this section in agent/index.js:
```javascript
for (const [index, time] of preferredTimes.entries()) {
  try {
    console.log(`Trying time slot: ${time}`);
    const booked = await tryBookTime(page, time);  // ← ADD players here
    if (booked) {
      bookedTime = time;
      fallbackLevel = index;
      break;
    }
```

Change to:
```javascript
for (const [index, time] of preferredTimes.entries()) {
  try {
    console.log(`Trying time slot: ${time}`);
    const booked = await tryBookTime(page, time, config.players);  // ← Pass players
    if (booked) {
      bookedTime = time;
      fallbackLevel = index;
      break;
    }
```

---

## STEP 3: Test with Manual Script (1 hour)

### Create Test Script

Create file: `agent/test-booking-manual.js`

```javascript
import { chromium } from '@playwright/test';

const USERNAME = '12390624';
const PASSWORD = 'cantona7777';
const TARGET_TIME = '07:30'; // Change to available time
const PLAYERS = ['Sharpe, Mal', 'Someone, Else'];

async function testBooking() {
  const browser = await chromium.launch({ headless: false }); // Use headless: false to see
  const page = await browser.newPage();
  
  console.log('🔐 Logging in...');
  await page.goto('https://members.brsgolf.com/galgorm/login');
  
  // Accept cookies
  const cookieBtn = page.locator('button:has-text("Accept")').first();
  if (await cookieBtn.count() > 0) await cookieBtn.click();
  
  // Login
  await page.getByPlaceholder(/8 digit GUI|username/i).fill(USERNAME);
  await page.getByPlaceholder(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /login/i }).click();
  
  // Wait for redirect
  await page.waitForURL(/(?!.*\/login)/, { timeout: 15000 });
  console.log('✅ Logged in');
  
  // Navigate to tee sheet
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate() + 1).padStart(2, '0'); // Tomorrow
  
  const teeSheetUrl = `https://members.brsgolf.com/galgorm/tee-sheet/1/${y}/${m}/${d}`;
  console.log(`📅 Going to ${teeSheetUrl}`);
  await page.goto(teeSheetUrl);
  
  // Wait for times to appear
  await page.locator('text=/\\b(?:0?\\d|1\\d|2[0-3]):[0-5]\\d\\b/').first().waitFor();
  console.log('🕐 Tee sheet loaded');
  
  // Click time slot
  const hhmm = TARGET_TIME.replace(/[^0-9]/g, '');
  const timeLink = page.locator(`a[href*="/bookings/book/${hhmm}"]`).first();
  
  if (await timeLink.count() === 0) {
    console.error(`❌ Time ${TARGET_TIME} not found. Available times:`);
    const times = await page.locator('text=/\\b(?:0?\\d|1\\d|2[0-3]):[0-5]\\d\\b/').allTextContents();
    console.log(times);
    await browser.close();
    return;
  }
  
  console.log(`⏱️ Clicking ${TARGET_TIME}...`);
  await timeLink.click();
  await page.waitForTimeout(1000);
  
  // Inspect the form
  console.log('📋 Inspecting booking form...');
  const formHtml = await page.content();
  const playerSectionStart = formHtml.indexOf('<select');
  const playerSectionEnd = formHtml.indexOf('</select>') + 10;
  if (playerSectionStart > -1) {
    console.log('Found form HTML:');
    console.log(formHtml.substring(playerSectionStart, playerSectionEnd + 500));
  }
  
  // Take screenshot
  await page.screenshot({ path: 'booking-form-screenshot.png' });
  console.log('📸 Screenshot saved to booking-form-screenshot.png');
  
  console.log('\n✋ PAUSED - Inspect the form, then press Enter to continue');
  await new Promise(r => process.stdin.once('data', r));
  
  // Fill players
  console.log(`👥 Filling players: ${PLAYERS.join(', ')}`);
  
  // Try different selectors
  const player2Selectors = [
    'select[name="player_2"]',
    'select#player-2',
    'select#player_2',
    '[data-player="2"] select',
  ];
  
  for (const sel of player2Selectors) {
    const elem = page.locator(sel).first();
    if (await elem.count() > 0) {
      console.log(`  Found player 2 with selector: ${sel}`);
      await elem.selectOption({ label: PLAYERS[0] }).catch(e => console.error(e));
      break;
    }
  }
  
  // Click confirm
  const confirmBtn = page.locator('button:has-text("Confirm"), button:has-text("Book Now")').first();
  if (await confirmBtn.count() > 0) {
    console.log('✅ Clicking confirm...');
    await confirmBtn.click();
    await page.waitForTimeout(2000);
    
    // Check result
    const successMsg = page.locator('text=/booked|confirmed|success/i').first();
    if (await successMsg.count() > 0) {
      console.log('🎉 BOOKING SUCCESS!');
      console.log(await successMsg.textContent());
    }
  }
  
  // Final screenshot
  await page.screenshot({ path: 'booking-result-screenshot.png' });
  console.log('📸 Final screenshot saved');
  
  // Pause to see result
  await page.waitForTimeout(5000);
  await browser.close();
}

testBooking().catch(console.error);
```

### Run the Test
```powershell
cd C:\Users\stuar\Projects\fairway_sniper\agent
node test-booking-manual.js
```

This will:
1. Open browser (headless: false so you can see it)
2. Log in
3. Navigate to tee sheet
4. Click a time slot
5. Show you the form HTML
6. Wait for your input
7. Try to fill and confirm
8. Take screenshots of the result

---

## STEP 4: Update Agent with Real Selectors (1 hour)

Once you know the actual form structure, update `agent/index.js`:

1. Replace placeholder selectors with real ones
2. Test with the manual script again
3. Verify booking appears in BRS account
4. Fix any issues

---

## STEP 5: Integrate with Immediate Booking Endpoint (30 mins)

The `/api/book-now` endpoint is already in place and calls `runBooking()`. Once `tryBookTime()` is fixed:

1. Test via API:
```powershell
$body = @{
  username = "12390624"
  password = "cantona7777"
  targetDate = (Get-Date -Date "2025-12-12").ToString("yyyy-MM-dd")
  preferredTimes = @("07:30", "08:00")
  players = @("Sharpe, Mal", "Guest")
  pushToken = "test-token"
} | ConvertTo-Json

Invoke-WebRequest -Uri "http://localhost:3000/api/book-now" `
  -Method POST `
  -Body $body `
  -ContentType "application/json"
```

2. Watch agent logs to debug
3. Verify booking in BRS

---

## STEP 6: Test via Flutter (30 mins)

Once API works:

1. Start agent: `node index.js`
2. Run Flutter: `flutter run -d chrome`
3. Create a new Normal booking through the UI
4. Watch agent logs
5. Check BRS account for booking

---

## Critical Gotchas to Watch For

| Issue | Solution |
|-------|----------|
| Select2 dropdowns (BRS uses these) | Use `selectOption()` with label, not value |
| Players already in slot | Error message will say "slot full" or similar |
| Form validation errors | Check for validation error messages before confirm |
| Timing issues (clicking before form loaded) | Add explicit waits for form elements |
| Confirm button text varies | Use multiple selector patterns |
| Session expires | Ensure login fully completes before proceeding |

---

## Success Indicators

✅ You're on the right track when:
- Form appears after clicking time
- Player selects populate with names
- Confirm button is found and clicked
- No JavaScript errors in agent logs

🎯 You're done when:
- Agent logs show "✅ Clicked confirm for XX:XX"
- BRS account shows the booking
- FCM notification sent to user (if push token works)
- Flutter shows "Booking Confirmed"

---

## If You Get Stuck

**Most Common Issues:**

1. **"No slot link found"** → Time slot doesn't exist or wrong selector
   - Double-check available times on tee sheet
   - Verify `hhmm` format matches link href

2. **"No confirm button found"** → Button doesn't exist or wrong selector
   - Screenshot the form to see what's there
   - Try different button text patterns

3. **"No player dropdown found"** → Selector doesn't match actual form
   - Inspect element in Chrome DevTools
   - Copy exact `name`, `id`, or class
   - Test selector with `page.locator()` in script

4. **"Already booked error"** → Slot got taken between selection and booking
   - This is expected behavior; agent should try fallback time
   - Make sure you have multiple preferred times set

---

**You've got this. The hardest part is already done. Now make one booking work!**
