param(
  [string]$StartDate = $(Get-Date -Format 'yyyy-MM-dd'),
  [int]$Days = 1,
  [string]$Username = $env:BRS_USERNAME,
  [string]$Password = $env:BRS_PASSWORD
)

$ErrorActionPreference = 'Stop'

if (-not $Username -or -not $Password) {
  Write-Host 'Set BRS_USERNAME and BRS_PASSWORD or pass -Username/-Password.' -ForegroundColor Yellow
  exit 1
}

$body = @{ startDate = $StartDate; days = $Days; username = $Username; password = $Password } | ConvertTo-Json -Depth 6

$response = Invoke-RestMethod -Uri "http://localhost:3000/api/fetch-tee-times-range" -Method Post -ContentType "application/json" -Body $body
$response | ConvertTo-Json -Depth 12 | Write-Host
