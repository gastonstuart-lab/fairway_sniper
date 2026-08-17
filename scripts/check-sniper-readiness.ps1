param(
  [string]$JobId = "",
  [string]$AgentUrl = "https://fairwaysniper-production.up.railway.app"
)

$ErrorActionPreference = "Stop"

function Get-Json($Path) {
  $uri = "$AgentUrl$Path"
  Invoke-RestMethod -Uri $uri -Method Get -TimeoutSec 20
}

function Write-Check($Label, $Ok, $Detail) {
  $status = if ($Ok) { "OK" } else { "FAIL" }
  $color = if ($Ok) { "Green" } else { "Red" }
  Write-Host ("[{0}] {1}: {2}" -f $status, $Label, $Detail) -ForegroundColor $color
  return $Ok
}

$allOk = $true

Write-Host "Fairway Sniper production readiness" -ForegroundColor Cyan
Write-Host "Agent: $AgentUrl"
Write-Host "Observed: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')"
Write-Host ""

$health = Get-Json "/api/health"
$allOk = (Write-Check "health" ($health.status -eq "ok") ($health | ConvertTo-Json -Compress)) -and $allOk

$runtime = Get-Json "/api/runtime-status"
$allOk = (Write-Check "safe mode" ($runtime.safeMode -eq $false) "safeMode=$($runtime.safeMode)") -and $allOk
$hasProjectIdentity = ($runtime.firebaseAdminReady -eq $true) -and ($null -ne $runtime.firebaseProjectId) -and ($runtime.firebaseProjectId.ToString().Length -gt 0)
$allOk = (Write-Check "firebase admin" $hasProjectIdentity "project=$($runtime.firebaseProjectId)") -and $allOk
$allOk = (Write-Check "runner enabled" (($runtime.agentRunMain -eq $true) -and ($runtime.sniperRunnerStarted -eq $true)) "agentRunMain=$($runtime.agentRunMain), runner=$($runtime.sniperRunnerStarted)") -and $allOk
Write-Host ("[INFO] active timers: {0}" -f $runtime.activeSniperTimers) -ForegroundColor Yellow

$warm = Get-Json "/api/warm-status"
Write-Host ("[INFO] warm: warm={0}, authenticated={1}, teeSheetLoaded={2}, targetDate={3}, lastError={4}" -f $warm.warm, $warm.authenticated, $warm.teeSheetLoaded, $warm.targetDate, $warm.lastError) -ForegroundColor Yellow

if ($JobId.Trim().Length -gt 0) {
  try {
    $job = Get-Json "/api/firestore/jobs/$JobId/status"
    $allOk = (Write-Check "job visible to agent" ($job.visibleToAgent -eq $true) "id=$($job.id), project=$($job.firebaseProjectId)") -and $allOk
    $allOk = (Write-Check "job accepted by runner" ($job.agentWillAccept -eq $true) "status=$($job.status), state=$($job.state), mode=$($job.mode)") -and $allOk
    Write-Host ("[INFO] job fire: computedFireTimeUtc={0}, scheduledFor={1}, warmState={2}, hasTimer={3}, claimedBy={4}" -f $job.computedFireTimeUtc, $job.scheduledFor, $job.warmState, $job.hasTimer, $job.claimedBy) -ForegroundColor Yellow
  } catch {
    $allOk = $false
    Write-Host "[FAIL] job visible to agent: $($_.Exception.Message)" -ForegroundColor Red
  }
} else {
  Write-Host "[WARN] No JobId supplied, so this did not prove a specific booking is visible to production." -ForegroundColor Yellow
}

if (-not $allOk) {
  exit 1
}
