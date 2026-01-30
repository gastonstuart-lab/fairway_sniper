# Detached startup for Fairway Sniper Agent
# Launches Node server in background, writes PID & rolling log.
# Usage:  ./start-agent-detached.ps1
# Stop:   ./stop-agent-detached.ps1
#
# How to verify:
#   pwsh -File .\agent\stop-agent-detached.ps1
#   pwsh -File .\agent\start-agent-detached.ps1
#   curl http://localhost:3000/api/health
#   curl -i http://localhost:3000/api/jobs/test

$ErrorActionPreference = 'Stop'
$agentDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $agentDir

$logFile = Join-Path $agentDir 'agent_detached.log'
$pidFile = Join-Path $agentDir 'agent_detached.pid'

if (Test-Path $pidFile) {
  $oldPid = Get-Content $pidFile | Select-Object -First 1
  if ($oldPid -and (Get-Process -Id $oldPid -ErrorAction SilentlyContinue)) {
    Write-Host "Existing agent process (PID $oldPid) detected. Stopping it first..." -ForegroundColor Yellow
    Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 600
  }
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

function Get-ListeningPids {
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
  return (@($pids) | Select-Object -Unique)
}

Write-Host "Stopping any process listening on :3000 (if any)..." -ForegroundColor DarkGray
$pids = Get-ListeningPids
if ($pids.Count -gt 0) {
  foreach ($listeningPid in $pids) {
    Write-Host "Killing PID $listeningPid on port 3000..." -ForegroundColor Yellow
    taskkill /PID $listeningPid /F | Out-Null
  }
  Start-Sleep -Milliseconds 600
} else {
  Write-Host "No process found on port 3000." -ForegroundColor DarkGray
}

if ((Get-ListeningPids).Count -gt 0) {
  Write-Host "Port 3000 is still in use. Aborting start." -ForegroundColor Red
  exit 1
}

Write-Host "Launching Fairway Sniper Agent (detached)..." -ForegroundColor Cyan
Write-Host "Log: $logFile" -ForegroundColor DarkGray

# Start node detached (route logs to file via cmd redirection)
$nodePath = (Get-Command node).Source
$entryFile = Join-Path $agentDir 'index.js'
$startInfo = New-Object System.Diagnostics.ProcessStartInfo
$startInfo.FileName = $env:ComSpec
$startInfo.Arguments = "/c `"`"$nodePath`" `"$entryFile`" >> `"$logFile`" 2>&1`""
$startInfo.WorkingDirectory = $agentDir
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true

$process = New-Object System.Diagnostics.Process
$process.StartInfo = $startInfo
$null = $process.Start()

# Async log append
Start-Job -Name FairwayAgentLog -ScriptBlock {
  param($pid, $log)
  $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
  if (-not $proc) { return }
  Add-Content -Path $log -Value "==== Agent started PID $pid at $(Get-Date -Format o) ===="
  while ($true) {
    if (Get-Process -Id $pid -ErrorAction SilentlyContinue) {
      Start-Sleep -Milliseconds 500
    } else {
      Add-Content -Path $log -Value "==== Agent PID $pid exited at $(Get-Date -Format o) ===="
      break
    }
  }
} -ArgumentList $process.Id, $logFile | Out-Null

# Pipe initial output snapshots
Start-Sleep -Milliseconds 300
"$($process.Id)" | Out-File -FilePath $pidFile -Encoding ascii
Write-Host "Agent PID: $($process.Id)" -ForegroundColor Green
Write-Host "Waiting 2s for server to bind..." -ForegroundColor DarkGray
Start-Sleep -Seconds 2

# Simple health probe
try {
  $resp = Invoke-WebRequest -Uri 'http://localhost:3000/api/health' -UseBasicParsing -TimeoutSec 3
  Write-Host "Health endpoint reachable (HTTP $($resp.StatusCode))." -ForegroundColor Green
} catch {
  Write-Host "Health probe failed: $($_.Exception.Message)" -ForegroundColor Yellow
  Write-Host "Check log tail: Get-Content $logFile -Tail 30" -ForegroundColor DarkGray
}

Write-Host "Done. Use Normal Mode refresh now or tail log." -ForegroundColor Cyan
