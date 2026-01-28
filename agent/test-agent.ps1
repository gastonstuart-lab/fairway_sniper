# Test the Fairway Sniper Agent
# This script starts the agent in the background, waits for it to be ready,
# runs a headed debug fetch, and then shows the results

Write-Host "=== Fairway Sniper Agent Test Script ===" -ForegroundColor Cyan
Write-Host ""

# Change to agent directory
$agentDir = Split-Path -Parent $PSScriptRoot | Join-Path -ChildPath "agent"
Set-Location -Path $agentDir

# Kill any existing node processes for the agent
Write-Host "Checking for existing agent processes..." -ForegroundColor Yellow
$existingProcesses = Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -like "*node.exe*"
}
if ($existingProcesses) {
    Write-Host "Stopping existing node processes..." -ForegroundColor Yellow
    $existingProcesses | Stop-Process -Force
    Start-Sleep -Seconds 2
}

# Start the agent in a background job
Write-Host "Starting agent HTTP server..." -ForegroundColor Yellow
$env:AGENT_RUN_MAIN = "false"
$agentJob = Start-Job -ScriptBlock {
    param($dir)
    Set-Location $dir
    $env:AGENT_RUN_MAIN = "false"
    node .\index.js
} -ArgumentList $agentDir

# Wait for the server to start
Write-Host "Waiting for server to start..." -ForegroundColor Yellow
$maxAttempts = 15
$attempt = 0
$serverReady = $false

while ($attempt -lt $maxAttempts -and -not $serverReady) {
    $attempt++
    Start-Sleep -Milliseconds 500
    
    try {
        $response = Invoke-RestMethod -Uri 'http://localhost:3000/api/health' -Method Get -TimeoutSec 2 -ErrorAction Stop
        if ($response.status -eq 'ok') {
            $serverReady = $true
            Write-Host "✅ Server is ready!" -ForegroundColor Green
        }
    } catch {
        Write-Host "  Attempt $attempt/$maxAttempts..." -ForegroundColor Gray
    }
}

if (-not $serverReady) {
    Write-Host "❌ Server failed to start after $maxAttempts attempts" -ForegroundColor Red
    Write-Host ""
    Write-Host "Job output:" -ForegroundColor Yellow
    Receive-Job -Job $agentJob
    Stop-Job -Job $agentJob
    Remove-Job -Job $agentJob
    exit 1
}

# Test the Playwright check endpoint
Write-Host ""
Write-Host "Testing Playwright availability..." -ForegroundColor Yellow
try {
    $playwrightCheck = Invoke-RestMethod -Uri 'http://localhost:3000/api/playwright-check' -Method Get -TimeoutSec 10
    Write-Host "✅ Playwright check: $($playwrightCheck.playwright)" -ForegroundColor Green
} catch {
    Write-Host "❌ Playwright check failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Run a headed debug fetch using saved storage state
Write-Host ""
Write-Host "Running headed debug fetch..." -ForegroundColor Yellow
Write-Host "(This will take 30-60 seconds, please wait...)" -ForegroundColor Gray
Write-Host ""

try {
    # Load the storage state if it exists
    $stateFile = Join-Path (Split-Path -Parent $agentDir) "automation\state.json"
    $storageState = $null
    
    if (Test-Path $stateFile) {
        Write-Host "Loading saved authentication state from automation\state.json" -ForegroundColor Cyan
        $storageState = Get-Content -Raw -Path $stateFile | ConvertFrom-Json
    } else {
        Write-Host "No saved authentication state found (this is okay for testing)" -ForegroundColor Yellow
    }
    
    # Prepare the request body
    $body = @{
        date = (Get-Date).ToString('yyyy-MM-dd')
        username = ''  # Fill in if not using storageState
        password = ''  # Fill in if not using storageState
        club = 'galgorm'
        debug = $true
        headed = $true
    }
    
    if ($storageState) {
        $body.storageState = $storageState
    }
    
    $bodyJson = $body | ConvertTo-Json -Depth 20
    
    # Make the request
    $result = Invoke-RestMethod -Uri 'http://localhost:3000/api/fetch-tee-times' `
        -Method Post `
        -ContentType 'application/json' `
        -Body $bodyJson `
        -TimeoutSec 120
    
    Write-Host "✅ Fetch completed!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Results:" -ForegroundColor Cyan
    Write-Host "  Found times: $($result.times.Count)" -ForegroundColor White
    if ($result.times) {
        Write-Host "  Times: $($result.times -join ', ')" -ForegroundColor White
    }
    if ($result.tracePath) {
        Write-Host "  Trace saved to: $($result.tracePath)" -ForegroundColor White
        Write-Host "  (Look for the trace file in agent/output/)" -ForegroundColor Gray
    }
    
} catch {
    Write-Host "❌ Fetch failed: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        Write-Host "Response: $($_.Exception.Response)" -ForegroundColor Red
    }
}

# Show the agent logs
Write-Host ""
Write-Host "Agent logs:" -ForegroundColor Yellow
Receive-Job -Job $agentJob

# Clean up
Write-Host ""
Write-Host "Stopping agent..." -ForegroundColor Yellow
Stop-Job -Job $agentJob
Remove-Job -Job $agentJob

Write-Host ""
Write-Host "=== Test Complete ===" -ForegroundColor Cyan
