param(
  [string]$Username = $env:BRS_USERNAME,
  [string]$Password = $env:BRS_PASSWORD,
  [string]$TargetDate = (Get-Date).ToString('yyyy-MM-dd'),
  [string]$PreferredTime = '08.20',
  [int]$Minutes = 1,
  [int]$PartySize = 2
)

$ErrorActionPreference = 'Stop'

if (-not $Username -or -not $Password) {
  Write-Host 'Missing credentials. Provide -Username and -Password or set BRS_USERNAME/BRS_PASSWORD.' -ForegroundColor Yellow
  exit 1
}

$body = @{
  username = $Username
  password = $Password
  targetDate = $TargetDate
  preferredTimes = @($PreferredTime)
  players = @()
  partySize = $PartySize
  minutes = $Minutes
} | ConvertTo-Json

Write-Host "Scheduling sniper test for $TargetDate at $PreferredTime (in $Minutes min)..." -ForegroundColor Cyan

$resp = Invoke-RestMethod -Uri 'http://localhost:3000/api/sniper-test' `
  -Method Post `
  -ContentType 'application/json' `
  -Body $body

$resp | ConvertTo-Json -Depth 6 | Write-Host

if (-not $resp.jobId) { exit 1 }

Write-Host "Polling job $($resp.jobId) ..." -ForegroundColor Cyan
$deadline = (Get-Date).AddMinutes(5)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 2
  try {
    $status = Invoke-RestMethod -Uri "http://localhost:3000/api/jobs/$($resp.jobId)" -TimeoutSec 10
    $status | ConvertTo-Json -Depth 6 | Write-Host
    if ($status.status -in @('success','failed')) { break }
  } catch {
    Write-Host "Status fetch failed: $($_.Exception.Message)" -ForegroundColor Yellow
  }
}
