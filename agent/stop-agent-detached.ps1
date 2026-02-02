# Stop detached Fairway Sniper Agent
$ErrorActionPreference = 'SilentlyContinue'
$agentDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidFile = Join-Path $agentDir 'agent_detached.pid'

Write-Host "Stopping any process listening on :3000 (if any)..." -ForegroundColor DarkGray
$pids = @()
try {
  $pids = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess
} catch { }
if (@($pids).Count -eq 0) {
  try {
    $lines = netstat -ano | Select-String -Pattern ':3000' | ForEach-Object { $_.Line }
    foreach ($line in $lines) {
      if ($line -match 'LISTENING') {
        $parts = $line -split '\s+'
        $pid = $parts[-1]
        if ($pid -match '^\d+$') { $pids += $pid }
      }
    }
  } catch { }
}
$pids = @($pids) | Select-Object -Unique
Write-Host ("Found PIDs: " + (($pids -join ',') -replace '^\s*$','none')) -ForegroundColor DarkGray
$killed = $false
foreach ($listeningPid in $pids) {
  $pidValue = 0
  try { $pidValue = [int]$listeningPid } catch { $pidValue = 0 }
  if ($pidValue -le 0) { continue }
  $killed = $true
  Write-Host "Killing PID $pidValue on port 3000..." -ForegroundColor Yellow
  taskkill /PID $pidValue /F | Out-Null
}
if (-not $killed) {
  Write-Host "No process found on port 3000." -ForegroundColor DarkGray
}

if (Test-Path $pidFile) {
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}
