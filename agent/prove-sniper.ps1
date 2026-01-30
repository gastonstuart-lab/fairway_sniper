# Sniper proof test helper (runs detached agent, schedules a 4-minute sniper job, and polls until the job completes)
$ErrorActionPreference = 'Stop'

$agentDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$logFile = Join-Path $agentDir 'agent_detached.log'
$baseUrl = 'http://localhost:3000'

if (-not $env:BRS_USERNAME -or -not $env:BRS_PASSWORD) {
  Write-Host 'Set BRS_USERNAME and BRS_PASSWORD environment variables first.' -ForegroundColor Yellow
  exit 1
}

function Invoke-HealthProbe {
  try {
    $resp = Invoke-RestMethod -Uri "$baseUrl/api/self-check" -TimeoutSec 10
    Write-Host "Self-check OK ✅ file=$($resp.file) routes=$($resp.routes.Count)" -ForegroundColor Green
    return $resp
  } catch {
    Write-Host "Self-check failed: $($_.Exception.Message)" -ForegroundColor Red
    return $null
  }
}

Write-Host '=== SNIPER PROOF TEST ===' -ForegroundColor Cyan
Write-Host 'Stopping any running agent...' -ForegroundColor Gray
pwsh -File (Join-Path $agentDir 'stop-agent-detached.ps1')

Write-Host 'Starting detached agent...' -ForegroundColor Gray
pwsh -File (Join-Path $agentDir 'start-agent-detached.ps1')
Start-Sleep -Seconds 5

$resp = Invoke-HealthProbe
if (-not $resp) {
  Write-Host 'Unable to contact agent; aborting proof test.' -ForegroundColor Red
  Write-Host '=== SNIPER PROOF RESULT ===' -ForegroundColor Cyan
  Write-Host '❌ FAILED: Agent not reachable.' -ForegroundColor Red
  exit 1
}

$routes = @()
if ($resp.routes -and ($resp.routes -is [System.Collections.IEnumerable])) {
  $routes = $resp.routes
}

if (-not ($routes -contains 'GET /api/jobs')) {
  Write-Host '=== SNIPER PROOF RESULT ===' -ForegroundColor Cyan
  Write-Host '❌ FAILED: GET /api/jobs route not detected — wrong entrypoint may be running.' -ForegroundColor Red
  Write-Host 'Detected routes:' -ForegroundColor Yellow
  $routes | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
  exit 1
}

$body = @{
  username = $env:BRS_USERNAME
  password = $env:BRS_PASSWORD
  targetDate = (Get-Date).ToString('yyyy-MM-dd')
  preferredTimes = @('08:00')
  players = @()
  partySize = 2
  minutes = 4
} | ConvertTo-Json

Write-Host 'Scheduling sniper test job (4 min)…' -ForegroundColor Cyan
$resp = Invoke-RestMethod -Uri "$baseUrl/api/sniper-test" `
  -Method Post `
  -ContentType 'application/json' `
  -Body $body `
  -TimeoutSec 600

$jobId = $resp.jobId
if (-not $jobId) {
  Write-Host "Agent did not return a jobId; response: $resp" -ForegroundColor Red
  exit 1
}

Write-Host "Job queued ✅ jobId=$jobId (scheduledFor=$($resp.scheduledFor))" -ForegroundColor Green
Write-Host 'Now close the Flutter app/browser; the sniper test continues in the background.' -ForegroundColor Yellow

$deadline = (Get-Date).AddMinutes(10)
$final = $null
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 2
  try {
    $status = Invoke-RestMethod -Uri "$baseUrl/api/jobs/$jobId" -TimeoutSec 10
  } catch {
    Write-Host "Status fetch failed: $($_.Exception.Message)" -ForegroundColor Yellow
    continue
  }

  Write-Host "[JOB $jobId] status=$($status.status)" -ForegroundColor DarkGray
  if ($status.status -in @('success', 'failed')) {
    $final = $status
    break
  }
}

if (-not $final) {
  Write-Host 'Timed out waiting for sniper test completion (10 min).' -ForegroundColor Yellow
  exit 1
}


if ($final.status -eq 'success') {
  Write-Host '=== SNIPER PROOF RESULT ===' -ForegroundColor Cyan
  Write-Host "✅ SUCCESS: Sniper works without UI (latencyMs=$($final.latencyMs))" -ForegroundColor Green
} else {
  Write-Host '=== SNIPER PROOF RESULT ===' -ForegroundColor Cyan
  Write-Host "❌ FAILED: Job failed — error=$($final.error)" -ForegroundColor Red
}

Write-Host "Log: $logFile" -ForegroundColor Cyan
if (-not (Test-Path $logFile)) {
  Write-Host "❌ FAILED: Log file not found at: $logFile" -ForegroundColor Red
  exit 1
}

Write-Host '=== AGENT LOG TAIL (last 30 lines) ===' -ForegroundColor Cyan
Get-Content $logFile -Tail 30
