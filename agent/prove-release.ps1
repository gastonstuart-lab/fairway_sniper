# Quick release-night proof trigger for the warm sniper
# Usage:
#   pwsh -File agent/prove-release.ps1 -HostUrl http://localhost:3000 `
#        -TargetDate 2026-02-05 -PreferredTimes 07:20 `
#        -FireTimeUtc 2026-02-04T19:20:00Z

param(
  [string]$HostUrl = "http://localhost:3000",
  [string]$Username = $env:BRS_USERNAME,
  [string]$Password = $env:BRS_PASSWORD,
  [string]$TargetDate = "2026-02-05",
  [string[]]$PreferredTimes = @("07:20"),
  [string]$FireTimeUtc = "2026-02-04T19:20:00Z",
  [string]$FireTimeUk = ""
)

if (-not $Username -or -not $Password) {
  Write-Error "Set BRS_USERNAME and BRS_PASSWORD or pass -Username/-Password."
  exit 1
}

$body = @{
  username       = $Username
  password       = $Password
  targetDate     = $TargetDate
  preferredTimes = $PreferredTimes
  players        = @()
  partySize      = 1
  fireTimeUtc    = $FireTimeUtc
  fireTimeUk     = $FireTimeUk
} | ConvertTo-Json -Depth 4

Write-Host "POST $HostUrl/api/sniper-test"
Write-Host $body

Invoke-RestMethod -Method Post -Uri "$HostUrl/api/sniper-test" `
  -ContentType "application/json" `
  -Body $body
