# Playwright Trace Inspection Guide

## Opening the Trace

The agent saved a Playwright trace to help debug why 0 times were found.

### Open the trace with Playwright's trace viewer:

```powershell
# From the agent directory
npx playwright show-trace agent-trace-2025-11-25.zip
```

This opens an interactive viewer showing:

- Screenshots of each page state
- Network requests
- Console logs
- DOM snapshots at each step
- Timeline of all actions

## What to Look For

### 1. Authentication Status

- **Check the first few screenshots**: Does the page show you're logged in?
- **Look for**: User profile indicator, "logout" button, or authenticated navigation
- **If you see a login page**: The storageState is expired or invalid

### 2. Navigation Success

- **Find the navigation to**: `https://members.brsgolf.com/galgorm/tee-sheet/1/2025/11/25`
- **Check**: Did the page load successfully?
- **Look for**: HTTP status codes in the network tab (should be 200)

### 3. Tee Sheet UI

- **Inspect the page DOM**: Use the snapshot viewer to see what actually loaded
- **Look for**:
  - Date headers (month names like "NOV", "DEC")
  - Time strings (format like "08:00", "09:30")
  - Rows or slots showing tee times
  - Any error messages or "no times available" text

### 4. Console Logs

- **Check for JavaScript errors**: Red text in the console tab
- **Look for**: Site-specific errors that might block rendering

## Common Issues & Fixes

### Issue: Login page visible (authentication failed)

**Fix**: The storageState from `automation/state.json` is expired.

- Re-run the automation tests to generate fresh state:
  ```powershell
  cd ..\automation
  npx playwright test login.spec.ts --headed
  ```
- Then retry the agent fetch

### Issue: "No times available" or empty schedule

**Possible causes**:

1. The date (Nov 25, 2025) doesn't have tee times released yet
2. Times are sold out
3. The club calendar doesn't go that far ahead

**Fix**: Try a different date or check the actual website manually

### Issue: Page loaded but wrong selectors

**Symptoms**: Page looks correct but agent logs show "0 time nodes on page"
**Fix**: The site structure changed or our selectors don't match

- Inspect the DOM snapshot in the trace viewer
- Right-click on a time element → "Copy selector"
- Update the selectors in `agent/index.js` around line 640-750

### Issue: Page in iframe

**Symptoms**: Trace shows a parent page but the tee sheet is inside an iframe
**Fix**: The agent tries to detect iframes but may need site-specific tuning

- Note the iframe src/id from the trace
- Update `rootFrameSelectors` array in `agent/index.js` around line 688

## Next Steps After Inspection

1. **If auth failed**: Regenerate `automation/state.json` and retry
2. **If date has no times**: Try a date closer to today (within booking window)
3. **If selectors wrong**: Copy actual selectors from trace and update code
4. **If site structure changed**: May need to rewrite scraping logic based on current site

## Quick Test with Different Date

```powershell
# Try tomorrow instead of today
$ss = Get-Content -Raw -Path '..\automation\state.json' | ConvertFrom-Json
$tomorrow = (Get-Date).AddDays(1).ToString('yyyy-MM-dd')
$body = @{
  date = $tomorrow
  club = 'galgorm'
  debug = $true
  headed = $true
  storageState = $ss
}
Invoke-RestMethod -Uri 'http://localhost:3000/api/fetch-tee-times' `
  -Method Post `
  -ContentType 'application/json' `
  -Body ($body | ConvertTo-Json -Depth 20) `
  -TimeoutSec 120
```

## Understanding the Agent Logs

From your last run:

```
Still waiting for tee-sheet UI...  (repeated)
Warning: tee-sheet UI not detected within timeout
No iframe root matched; using full page root. time nodes on page: 0
Structured row selector matched 0 rows
```

This means:

- The agent waited 25 seconds for date headers or times to appear
- Nothing matched the expected patterns
- The page either didn't load, or the structure is different than expected

**Action**: Open the trace and visually confirm what actually loaded!
