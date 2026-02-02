# TEST_SNIPER_MODE.ps1
# Comprehensive test of Sniper Mode release-watch booking

Write-Host "=== SNIPER MODE TEST ===" -ForegroundColor Cyan
Write-Host ""

# 1. Agent health check
Write-Host "1. Checking agent health..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "http://localhost:3000/api/health" -Method GET -TimeoutSec 5
    Write-Host "   ✓ Agent is healthy" -ForegroundColor Green
} catch {
    Write-Host "   ✗ Agent not responding" -ForegroundColor Red
    exit 1
}

# 2. Test 4-minute sniper (from agent/prove-sniper-4min.ps1)
Write-Host ""
Write-Host "2. Testing 4-minute sniper execution..." -ForegroundColor Yellow

# Read credentials
if (-not $env:BRS_EMAIL) {
    $BRS_EMAIL = Read-Host "Enter BRS email"
    $BRS_PASSWORD = Read-Host "Enter BRS password" -AsSecureString
    $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($BRS_PASSWORD)
    $BRS_PASSWORD = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
} else {
    $BRS_EMAIL = $env:BRS_EMAIL
    $BRS_PASSWORD = $env:BRS_PASSWORD
}

$targetDate = (Get-Date).AddMinutes(4).ToString("yyyy-MM-dd")
$targetTime = (Get-Date).AddMinutes(4).ToString("HH:mm")

$sniperBody = @{
    baseUrl = "https://ncgolfassociation.chronogolf.com"
    username = $BRS_EMAIL
    password = $BRS_PASSWORD
    club = "ncgolfclub"
    targetDate = $targetDate
    targetTime = $targetTime
    players = @(
        @{
            id = "1111111"
            name = "Test Player"
            category = "You"
        }
    )
    testMode = $true
} | ConvertTo-Json -Depth 10

Write-Host "   Target: $targetDate $targetTime (4 minutes from now)" -ForegroundColor Gray

try {
    $result = Invoke-RestMethod -Uri "http://localhost:3000/api/release-snipe" -Method POST -Body $sniperBody -ContentType "application/json" -TimeoutSec 300
    
    if ($result.success) {
        Write-Host "   ✓ Sniper executed successfully" -ForegroundColor Green
        Write-Host "   Release detected: $($result.releaseDetected)" -ForegroundColor Gray
        Write-Host "   Booking attempted: $($result.bookingAttempted)" -ForegroundColor Gray
    } else {
        Write-Host "   ✗ Sniper failed: $($result.error)" -ForegroundColor Red
    }
} catch {
    Write-Host "   ✗ Sniper execution error: $_" -ForegroundColor Red
    exit 1
}

# 3. Manual wizard test instructions
Write-Host ""
Write-Host "3. Manual Sniper Mode wizard test:" -ForegroundColor Yellow
Write-Host "   a. Open app → Dashboard → tap 'Start Sniper Job'" -ForegroundColor Gray
Write-Host "   b. Enter credentials → Next" -ForegroundColor Gray
Write-Host "   c. Select target date (tomorrow 19:20) → Next" -ForegroundColor Gray
Write-Host "   d. Select 1-4 players → Next" -ForegroundColor Gray
Write-Host "   e. Review and activate sniper" -ForegroundColor Gray
Write-Host ""
Write-Host "   Expected behavior:" -ForegroundColor Cyan
Write-Host "   • Player selector shows 'You and your buddies' tab" -ForegroundColor Cyan
Write-Host "   • No 'Scanning...' (sniper doesn't need availability)" -ForegroundColor Cyan
Write-Host "   • Job saves to Firestore (or local if Firebase not configured)" -ForegroundColor Cyan
Write-Host "   • Sniper waits until 19:20 release time" -ForegroundColor Cyan
Write-Host "   • Auto-books when time becomes available" -ForegroundColor Cyan
Write-Host ""
Write-Host "=== SNIPER MODE TEST COMPLETE ===" -ForegroundColor Green
