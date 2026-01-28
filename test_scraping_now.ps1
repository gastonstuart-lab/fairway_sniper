# Quick test of player directory scraping with your actual credentials
Write-Host "==================================" -ForegroundColor Cyan
Write-Host "Player Directory Scraping Test" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Check if agent is running
Write-Host "[1/3] Checking if agent is running..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "http://localhost:3000/health" -TimeoutSec 5
    Write-Host "✅ Agent is running!" -ForegroundColor Green
    Write-Host "    Status: $($health.status)" -ForegroundColor Gray
    Write-Host ""
} catch {
    Write-Host "❌ Agent is NOT running!" -ForegroundColor Red
    Write-Host "    Please start the agent first with: cd agent; node index.js" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

# Step 2: Test player directory endpoint
Write-Host "[2/3] Fetching player directory..." -ForegroundColor Yellow
$body = @{
    username = "12390624"
    password = "cantona7777"
    club = "galgorm"
    debug = $true
    headed = $false
} | ConvertTo-Json

Write-Host "    URL: http://localhost:3000/api/brs/fetch-player-directory" -ForegroundColor Gray
Write-Host "    Club: galgorm" -ForegroundColor Gray
Write-Host "    Debug: enabled" -ForegroundColor Gray
Write-Host ""

try {
    $startTime = Get-Date
    $response = Invoke-RestMethod -Uri "http://localhost:3000/api/brs/fetch-player-directory" `
        -Method Post `
        -ContentType "application/json" `
        -Body $body `
        -TimeoutSec 60
    $duration = ((Get-Date) - $startTime).TotalSeconds

    Write-Host "✅ SUCCESS! Request completed in $([math]::Round($duration, 2))s" -ForegroundColor Green
    Write-Host ""

    # Step 3: Display results
    Write-Host "[3/3] Results:" -ForegroundColor Yellow
    Write-Host ""
    
    if ($response.success) {
        Write-Host "📊 Summary:" -ForegroundColor Cyan
        Write-Host "    Generated at: $($response.generatedAt)" -ForegroundColor Gray
        Write-Host "    Categories: $($response.categories.Count)" -ForegroundColor Gray
        Write-Host ""

        $totalPlayers = 0
        foreach ($category in $response.categories) {
            $totalPlayers += $category.players.Count
            Write-Host "📁 Category: $($category.name)" -ForegroundColor White
            Write-Host "   Players: $($category.players.Count)" -ForegroundColor Gray
            
            # Show first 10 players as sample
            $sample = $category.players | Select-Object -First 10
            foreach ($player in $sample) {
                Write-Host "      • $($player.name)" -ForegroundColor DarkGray
            }
            
            if ($category.players.Count -gt 10) {
                Write-Host "      ... and $($category.players.Count - 10) more" -ForegroundColor DarkGray
            }
            Write-Host ""
        }

        Write-Host "=====================================" -ForegroundColor Cyan
        Write-Host "✅ TOTAL PLAYERS FOUND: $totalPlayers" -ForegroundColor Green
        Write-Host "=====================================" -ForegroundColor Cyan
        
    } else {
        Write-Host "❌ Request succeeded but returned failure:" -ForegroundColor Red
        Write-Host "    Error: $($response.error)" -ForegroundColor Red
    }

} catch {
    Write-Host "❌ Request failed!" -ForegroundColor Red
    Write-Host "    Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.ErrorDetails) {
        Write-Host "    Details: $($_.ErrorDetails.Message)" -ForegroundColor Red
    }
    exit 1
}
