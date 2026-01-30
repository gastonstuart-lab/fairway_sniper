$ErrorActionPreference = 'Stop'

$username = $env:BRS_USERNAME
$password = $env:BRS_PASSWORD

if (-not $username -or -not $password) {
  Write-Host "Set BRS_USERNAME and BRS_PASSWORD env vars first." -ForegroundColor Yellow
  exit 1
}

$targetDate = (Get-Date).ToString('yyyy-MM-dd')
$body = @{
  username = $username
  password = $password
  targetDate = $targetDate
  preferredTimes = @('08:00')
  players = @()
  partySize = 2
  minutes = 4
} | ConvertTo-Json

Write-Host "Calling sniper test (4 min)..." -ForegroundColor Cyan
Write-Host "Target date: $targetDate" -ForegroundColor Gray

$resp = Invoke-RestMethod -Uri "http://localhost:3000/api/sniper-test" `
  -Method Post `
  -ContentType "application/json" `
  -Body $body `
  -TimeoutSec 600

$json = $resp | ConvertTo-Json -Depth 6
Write-Host $json

$jobId = $resp.jobId
if (-not $jobId) {
  Write-Host "No jobId returned; cannot poll status." -ForegroundColor Yellow
  exit 1
}

Write-Host "Polling job status for $jobId ..." -ForegroundColor Cyan
$deadline = (Get-Date).AddMinutes(10)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 2
  try {
    $status = Invoke-RestMethod -Uri "http://localhost:3000/api/jobs/$jobId" -TimeoutSec 10
  } catch {
    Write-Host "Status fetch failed: $($_.Exception.Message)" -ForegroundColor Yellow
    continue
  }

  Write-Host ($status | ConvertTo-Json -Depth 6)
  if ($status.status -in @('success', 'failed')) {
    Write-Host "Job finished with status: $($status.status)" -ForegroundColor Green
    exit 0
  }
}

Write-Host "Timed out waiting for job completion." -ForegroundColor Yellow
exit 1
