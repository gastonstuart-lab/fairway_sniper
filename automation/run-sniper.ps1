param(
  [string]$TargetDate,
  [string]$TargetTimes,
  [string]$ReleaseAtLocal,
  [switch]$RealRun
)

# Default to env or sensible fallbacks
if (-not $TargetDate) {
  $TargetDate = (Get-Date).AddDays(7).ToString('yyyy-MM-dd')
}
if (-not $TargetTimes) {
  $TargetTimes = '07:56,08:04'
}
if (-not $ReleaseAtLocal) {
  $ReleaseAtLocal = (Get-Date).AddMinutes(2).ToString('yyyy-MM-ddTHH:mm:00')
}

Write-Host "🎯 Sniper config:" -ForegroundColor Cyan
Write-Host "  TargetDate      = $TargetDate"
Write-Host "  TargetTimes     = $TargetTimes"
Write-Host "  ReleaseAtLocal  = $ReleaseAtLocal"
Write-Host "  Dry run         = $(-not $RealRun.IsPresent)"""

# Ensure we run from the script directory
Set-Location -Path (Split-Path -Parent $MyInvocation.MyCommand.Path)

# Ensure login state is fresh
Write-Host "🔐 Ensuring login is fresh (login.spec.ts)..." -ForegroundColor Yellow
npx playwright test tests/login.spec.ts --headed

if ($LASTEXITCODE -ne 0) {
  Write-Error "Login test failed; aborting sniper run."
  exit $LASTEXITCODE
}

# Set environment for sniper
$env:FS_TARGET_DATE = $TargetDate
$env:FS_TARGET_TIMES = $TargetTimes
$env:FS_RELEASE_AT_LOCAL = $ReleaseAtLocal
$env:FS_TZ = 'Europe/London'
$env:FS_DRY_RUN = if ($RealRun.IsPresent) { 'false' } else { 'true' }

Write-Host "🚀 Starting sniper (sniper.spec.ts)..." -ForegroundColor Green
npx playwright test tests/sniper.spec.ts --project=chromium
exit $LASTEXITCODE
