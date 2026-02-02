# TEST_NORMAL_MODE.ps1
# Comprehensive test of Normal Mode immediate booking

Write-Host "=== NORMAL MODE TEST ===" -ForegroundColor Cyan
Write-Host ""

# 1. Agent health check
Write-Host "1. Checking agent health..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "http://localhost:3000/api/health" -Method GET -TimeoutSec 5
    Write-Host "   ✓ Agent is healthy" -ForegroundColor Green
    Write-Host "   Session: $($health.warmSession.active)" -ForegroundColor Gray
} catch {
    Write-Host "   ✗ Agent not responding" -ForegroundColor Red
    Write-Host "   Run: cd agent; .\start-agent.ps1" -ForegroundColor Yellow
    exit 1
}

# 2. Fetch player directory
Write-Host ""
Write-Host "2. Testing player directory fetch..." -ForegroundColor Yellow

# Read credentials from user
if (-not $env:BRS_EMAIL) {
    $BRS_EMAIL = Read-Host "Enter BRS email"
    $BRS_PASSWORD = Read-Host "Enter BRS password" -AsSecureString
    $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($BRS_PASSWORD)
    $BRS_PASSWORD = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
} else {
    $BRS_EMAIL = $env:BRS_EMAIL
    $BRS_PASSWORD = $env:BRS_PASSWORD
}

$playerBody = @{
    baseUrl = "https://ncgolfassociation.chronogolf.com"
    username = $BRS_EMAIL
    password = $BRS_PASSWORD
} | ConvertTo-Json

try {
        $players = Invoke-RestMethod -Uri "http://localhost:3000/api/brs/player-directory" -Method POST -Body $playerBody -ContentType "application/json" -TimeoutSec 90
    Write-Host "   ✓ Player directory fetched" -ForegroundColor Green
        Write-Host "   Categories: $($players.categories.Count)" -ForegroundColor Gray
    
        foreach ($cat in $players.categories) {
            Write-Host "     - $($cat.name): $($cat.players.Count) players" -ForegroundColor Gray
        }
} catch {
    Write-Host "   ✗ Player directory failed: $_" -ForegroundColor Red
    exit 1
}

# 3. Fetch 5-day availability
Write-Host ""
Write-Host "3. Testing 5-day availability scan..." -ForegroundColor Yellow
$rangeBody = @{
    baseUrl = "https://ncgolfassociation.chronogolf.com"
    username = $BRS_EMAIL
    password = $BRS_PASSWORD
    startDate = (Get-Date).ToString("yyyy-MM-dd")
    days = 5
    club = "ncgolfclub"
    reuseBrowser = $false
} | ConvertTo-Json

try {
    $availability = Invoke-RestMethod -Uri "http://localhost:3000/api/fetch-tee-times-range" -Method POST -Body $rangeBody -ContentType "application/json" -TimeoutSec 90
    Write-Host "   ✓ Availability fetched" -ForegroundColor Green
    
    $days = $availability.days
    if (-not $days) { throw "No days array returned" }
    foreach ($day in $days) {
        $dayOfWeek = (Get-Date $day.date).DayOfWeek
        $timeCount = $day.times.Count
        $slotInfo = ""
        if ($day.slots.Count -gt 0) {
            $openCounts = $day.slots | ForEach-Object { "$($_.openSlots)/$($_.totalSlots)" } | Select-Object -Unique
            $slotInfo = " [$($openCounts -join ', ')]"
        }
        Write-Host "     - $dayOfWeek $($day.date): $timeCount times$slotInfo" -ForegroundColor Gray
        
        # Sunday should have 0 times if course closed
        if ($dayOfWeek -eq "Sunday" -and $timeCount -gt 0) {
            Write-Host "       ⚠️  Sunday has times (should be 0 if closed)" -ForegroundColor Yellow
        }
    }
} catch {
    Write-Host "   ✗ Availability scan failed: $_" -ForegroundColor Red
    exit 1
}

# 4. Manual wizard test instructions
Write-Host ""
Write-Host "4. Manual Normal Mode wizard test:" -ForegroundColor Yellow
Write-Host "   a. Open app → Dashboard → tap 'Book Tee Time'" -ForegroundColor Gray
Write-Host "   b. Enter credentials → Next" -ForegroundColor Gray
Write-Host "   c. Select Monday 08:20 → Next" -ForegroundColor Gray
Write-Host "   d. Select 1 player → Next" -ForegroundColor Gray
Write-Host "   e. Confirm booking details → Book Now" -ForegroundColor Gray
Write-Host ""
Write-Host "   Expected behavior:" -ForegroundColor Cyan
Write-Host "   • No 'Scanning...' on booking page (uses dashboard prefetch)" -ForegroundColor Cyan
Write-Host "   • Slot counts show 1/4, 2/4, 3/4, or 4/4" -ForegroundColor Cyan
Write-Host "   • Player categories: You, You and your buddies, Guests, Members" -ForegroundColor Cyan
Write-Host "   • Sunday shows 'No times' if course closed" -ForegroundColor Cyan
Write-Host "   • Booking completes in <60s" -ForegroundColor Cyan
Write-Host ""
Write-Host "=== NORMAL MODE TEST COMPLETE ===" -ForegroundColor Green
