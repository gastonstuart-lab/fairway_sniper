# Quick Booking Test - Verify the agent can detect and book tee times
# This tests the booking logic without waiting for an actual release time

Write-Host "=== Booking Logic Test ===" -ForegroundColor Cyan
Write-Host ""

Set-Location 'C:\Users\stuar\Projects\fairway_sniper\automation'

Write-Host "Testing booking detection for dates within the 7-day window..." -ForegroundColor Yellow
Write-Host ""

# Calculate a date within the booking window (today + 2 days)
$targetDate = (Get-Date).AddDays(2).ToString('yyyy-MM-dd')
Write-Host "Target date: $targetDate" -ForegroundColor White
Write-Host "Target times: 08:00, 09:00, 10:00" -ForegroundColor White
Write-Host ""

# Set environment for the test
$env:FS_DRY_RUN = 'true'
$env:FS_TARGET_DATE = $targetDate
$env:FS_TARGET_TIMES = '08:00,09:00,10:00'
$env:FS_SEARCH_DAYS = '7'

Write-Host "Running find_slots test (this will scan the tee sheet and look for available times)..." -ForegroundColor Yellow
Write-Host ""

npx playwright test find_slots.spec.ts --headed

Write-Host ""
Write-Host "=== Test Complete ===" -ForegroundColor Cyan
Write-Host ""

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Test passed! The booking logic can detect available slots." -ForegroundColor Green
    Write-Host ""
    Write-Host "Next step: Set up a real booking job for the next release time" -ForegroundColor White
    Write-Host "  - Release times are typically Tuesday 7:20 PM for Saturday" -ForegroundColor Gray
    Write-Host "  - The agent will automatically book at the exact moment" -ForegroundColor Gray
} else {
    Write-Host "⚠️  Test had issues. Let's check the screenshot/video to see what happened." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Common issues:" -ForegroundColor White
    Write-Host "  - Date too far ahead (>7 days)" -ForegroundColor Gray
    Write-Host "  - No tee times available for that date" -ForegroundColor Gray
    Write-Host "  - Site requires calendar interaction" -ForegroundColor Gray
}
