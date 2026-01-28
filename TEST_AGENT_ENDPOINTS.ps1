#!/usr/bin/env pwsh
<#
.SYNOPSIS
Test all Fairway Sniper Agent HTTP endpoints

.DESCRIPTION
Verifies that the agent is running and all endpoints are functional
#>

param(
    [string]$BaseUrl = "http://localhost:3000"
)

function Test-Endpoint {
    param(
        [string]$Name,
        [string]$Method,
        [string]$Path,
        [hashtable]$Body
    )
    
    try {
        $params = @{
            Uri = "$BaseUrl$Path"
            Method = $Method
            TimeoutSec = 30
            ErrorAction = "Stop"
        }
        
        if ($Body) {
            $params["Body"] = ($Body | ConvertTo-Json)
            $params["ContentType"] = "application/json"
        }
        
        $response = Invoke-WebRequest @params
        $data = $response.Content | ConvertFrom-Json
        
        Write-Host "✅ $Name - SUCCESS" -ForegroundColor Green
        return $data
    }
    catch {
        Write-Host "❌ $Name - FAILED: $($_.Exception.Message)" -ForegroundColor Red
        return $null
    }
}

Write-Host "`n🚀 Fairway Sniper Agent Endpoint Tests`n" -ForegroundColor Cyan

# Test 1: Health
Write-Host "1. Health Check:"
$health = Test-Endpoint -Name "GET /api/health" -Method Get -Path "/api/health"
if ($health) {
    Write-Host "   Status: $($health.status), Service: $($health.service), Auth: $($health.authenticated)"
}

# Test 2: Fetch Tee Times
Write-Host "`n2. Fetch Tee Times (tomorrow):"
$tomorrow = (Get-Date).AddDays(1).ToString("yyyy-MM-dd")
$times = Test-Endpoint -Name "POST /api/fetch-tee-times" -Method Post -Path "/api/fetch-tee-times" -Body @{date=$tomorrow; club="galgorm"}
if ($times) {
    Write-Host "   Date: $($times.date), Found: $($times.count) slots"
    Write-Host "   Sample times: $($times.times[0..4] -join ', ')..."
}

# Test 3: Fetch Players
Write-Host "`n3. Fetch Players:"
$players = Test-Endpoint -Name "POST /api/fetch-players" -Method Post -Path "/api/fetch-players" -Body @{club="galgorm"}
if ($players) {
    Write-Host "   Total: $($players.count) players"
    Write-Host "   Source: $($players.source)"
    Write-Host "   Sample: $($players.players[0..2] -join ', ')..."
}

# Test 4: Book Tee Time
Write-Host "`n4. Book Tee Time:"
if ($times -and $players) {
    $bookResult = Test-Endpoint -Name "POST /api/book-tee-time" -Method Post -Path "/api/book-tee-time" -Body @{
        date=$tomorrow
        time=$times.times[0]
        players=@($players.players[0])
        club="galgorm"
    }
    if ($bookResult) {
        Write-Host "   Status: $($bookResult.status)"
        Write-Host "   Player: $($bookResult.player)"
        Write-Host "   Time: $($bookResult.time)"
    }
}

Write-Host "`n✅ All endpoint tests complete!`n" -ForegroundColor Green
