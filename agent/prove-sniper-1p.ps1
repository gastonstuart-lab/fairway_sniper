# Sniper Proof (1 player) Test Script
# Validates agent can book for 1 player at a specific time, even with UI closed

$ErrorActionPreference = 'Stop'

$agentDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$logFile = Join-Path $agentDir 'agent_detached.log'
$baseUrl = 'http://localhost:3000'

if (-not $env:BRS_USERNAME -or -not $env:BRS_PASSWORD) {
  Write-Host 'Set BRS_USERNAME and BRS_PASSWORD environment variables first.' -ForegroundColor Yellow
  exit 1
}

function Tail-Log($lines=80) {
  if (Test-Path $logFile) {
    Write-Host "=== AGENT LOG TAIL (last $lines lines) ===" -ForegroundColor Cyan
    Get-Content $logFile -Tail $lines
  } else {
    Write-Host "Log file not found at: $logFile" -ForegroundColor Red
  }
}

Write-Host '=== SNIPER PROOF 1P TEST ===' -ForegroundColor Cyan
Write-Host 'Stopping any running agent...' -ForegroundColor Gray
pwsh -File (Join-Path $agentDir 'stop-agent-detached.ps1')

Write-Host 'Starting detached agent...' -ForegroundColor Gray
pwsh -File (Join-Path $agentDir 'start-agent-detached.ps1')
Start-Sleep -Seconds 4

# Self-check
$resp = $null
try {
  $resp = Invoke-RestMethod -Uri "$baseUrl/api/self-check" -TimeoutSec 10
} catch {
  Write-Host 'Self-check failed: ' $_.Exception.Message -ForegroundColor Red
  Tail-Log 60
  exit 1
}

$routes = @()
if ($resp.routes -and ($resp.routes -is [System.Collections.IEnumerable])) {
  $routes = $resp.routes
}

$required = @('GET /api/jobs', 'GET /api/jobs/:jobId', 'POST /api/sniper-test')
$missing = $required | Where-Object { $routes -notcontains $_ }
if ($missing.Count -gt 0) {
  Write-Host '=== SNIPER PROOF RESULT ===' -ForegroundColor Cyan
  Write-Host ("❌ FAILED: Missing required routes: " + ($missing -join ', ')) -ForegroundColor Red
  Write-Host 'Detected routes:' -ForegroundColor Yellow
  $routes | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
  Tail-Log 60
  exit 1
}

# Schedule sniper test
$body = @{
  username = $env:BRS_USERNAME
  password = $env:BRS_PASSWORD
  targetDate = '2026-02-02'
  preferredTimes = @('08:20')
  players = @()
  partySize = 1
  minutes = 4
} | ConvertTo-Json

Write-Host 'Scheduling sniper test job (1 player, 2026-02-02 08:20)…' -ForegroundColor Cyan
$resp = $null
try {
  $resp = Invoke-RestMethod -Uri "$baseUrl/api/sniper-test" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 600
} catch {
  Write-Host 'Failed to schedule sniper test: ' $_.Exception.Message -ForegroundColor Red
  Tail-Log 60
  exit 1
}

$jobId = $resp.jobId
if (-not $jobId) {
  Write-Host "Agent did not return a jobId; response: $resp" -ForegroundColor Red
  Tail-Log 60
  exit 1
}

Write-Host "Job queued ✅ jobId=$jobId (scheduledFor=$($resp.scheduledFor))" -ForegroundColor Green

$deadline = (Get-Date).AddMinutes(10)
$final = $null
$statusLast = ''
$lastPrint = Get-Date
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 2
  try {
    $status = Invoke-RestMethod -Uri "$baseUrl/api/jobs/$jobId" -TimeoutSec 10
  } catch {
    Write-Host "Status fetch failed: $($_.Exception.Message)" -ForegroundColor Yellow
    continue
  }
  $now = Get-Date
  $print = $false
  if ($status.status -ne $statusLast) { $print = $true }
  elseif (($now - $lastPrint).TotalSeconds -ge 5) { $print = $true }
  if ($print) {
    Write-Host "[JOB $jobId] status=$($status.status)" -ForegroundColor DarkGray
    $statusLast = $status.status
    $lastPrint = $now
  }
  if ($status.status -in @('success', 'failed')) {
    $final = $status
    break
  }
}

if (-not $final) {
  Write-Host 'Timed out waiting for sniper test completion (10 min).' -ForegroundColor Yellow
  Tail-Log 80
  exit 1
}

Write-Host '=== SNIPER PROOF RESULT ===' -ForegroundColor Cyan
if ($final.status -eq 'success') {
  Write-Host ("✅ SUCCESS: Sniper works for 1 player! latencyMs=$($final.latencyMs)") -ForegroundColor Green
  Write-Host ("Result: $($final.result)") -ForegroundColor Green
  Tail-Log 80
  exit 0
} else {
  Write-Host ("❌ FAILED: Job failed — error=$($final.error)") -ForegroundColor Red
  Tail-Log 80
  exit 1
}
