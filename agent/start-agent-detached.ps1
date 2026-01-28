# Detached startup for Fairway Sniper Agent
# Launches Node server in background, writes PID & rolling log.
# Usage:  ./start-agent-detached.ps1
# Stop:   ./stop-agent-detached.ps1  (will be created automatically on first run)

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

Write-Host "Launching Fairway Sniper Agent (detached)..." -ForegroundColor Cyan
Write-Host "Log: $logFile" -ForegroundColor DarkGray

# Start node detached
$startInfo = New-Object System.Diagnostics.ProcessStartInfo
$startInfo.FileName = (Get-Command node).Source
$startInfo.Arguments = 'index.js'
$startInfo.WorkingDirectory = $agentDir
$startInfo.RedirectStandardOutput = $true
$startInfo.RedirectStandardError = $true
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

# Generate stop script
$stopScript = @"
# Stop detached Fairway Sniper Agent
if (Test-Path '$pidFile') {
  `$agentPid = Get-Content '$pidFile' | Select-Object -First 1
  if (`$agentPid -and (Get-Process -Id `$agentPid -ErrorAction SilentlyContinue)) {
    Write-Host "Stopping agent PID `$agentPid" -ForegroundColor Yellow
    Stop-Process -Id `$agentPid -Force
  } else { Write-Host "No running agent process found." -ForegroundColor DarkGray }
  Remove-Item '$pidFile' -Force -ErrorAction SilentlyContinue
} else { Write-Host "PID file not found." -ForegroundColor DarkGray }
"@
$stopPath = Join-Path $agentDir 'stop-agent-detached.ps1'
$stopScript | Out-File -FilePath $stopPath -Encoding utf8 -Force
Write-Host "Created stop script: $stopPath" -ForegroundColor DarkGray

Write-Host "Done. Use Normal Mode refresh now or tail log." -ForegroundColor Cyan