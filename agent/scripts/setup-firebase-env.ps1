param(
  [Parameter(Mandatory=$true)]
  [string]$JsonPath
)

$ErrorActionPreference = 'Stop'

$secretsDir = Join-Path $PSScriptRoot '..\.secrets'
$secretsDir = (Resolve-Path $secretsDir).Path
if (!(Test-Path $secretsDir)) { New-Item -ItemType Directory -Path $secretsDir | Out-Null }

if (!(Test-Path $JsonPath)) { throw "Service account JSON not found: $JsonPath" }

$destPath = Join-Path $secretsDir (Split-Path $JsonPath -Leaf)
Move-Item -Path $JsonPath -Destination $destPath -Force

$svc = Get-Content -Raw -Path $destPath | ConvertFrom-Json
$envPath = Join-Path $PSScriptRoot '..\.env'
$privateKey = ($svc.private_key -replace "\r?\n", "\\n")

$lines = @(
  "# Auto-generated from service account JSON",
  "CLUB_LOGIN_URL=https://members.brsgolf.com/galgorm/login",
  "BRS_USERNAME=",
  "BRS_PASSWORD=",
  ("FIREBASE_PROJECT_ID=" + $svc.project_id),
  ("FIREBASE_CLIENT_EMAIL=" + $svc.client_email),
  ('FIREBASE_PRIVATE_KEY="' + $privateKey + '"'),
  "FCM_SERVER_KEY=",
  "TZ_LONDON=Europe/London",
  "AGENT_RUN_MAIN=true"
)

Set-Content -Path $envPath -Value $lines -Encoding UTF8
Write-Host "OK: .env created at $envPath" -ForegroundColor Green
Write-Host "Next: fill BRS_USERNAME and BRS_PASSWORD in the .env file." -ForegroundColor Yellow
