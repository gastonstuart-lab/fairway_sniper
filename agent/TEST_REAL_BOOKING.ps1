# TEST THE REAL AGENT BOOKING WITH PLAYER SELECTION
# This calls the ACTUAL agent that the Flutter app uses

$body = @{
    username = "12390624"
    password = "cantona7777"
    targetDate = "2026-01-29"
    preferredTimes = @("08:00", "08:30")
    players = @("12390624", "Guest", "Guest")  # Player IDs
    checkOnly = $false  # ACTUALLY TRY TO BOOK
} | ConvertTo-Json

Write-Host "`n🎯 Testing REAL agent booking with players..." -ForegroundColor Cyan
Write-Host "Calling: http://localhost:3000/api/snipe`n"

$response = Invoke-RestMethod `
    -Uri "http://localhost:3000/api/snipe" `
    -Method Post `
    -ContentType "application/json" `
    -Body $body

Write-Host "`n✅ RESPONSE:" -ForegroundColor Green
$response | ConvertTo-Json -Depth 5

Write-Host "`n📊 CHECK AGENT LOGS ABOVE FOR DETAILS`n" -ForegroundColor Yellow
