# Stop detached Fairway Sniper Agent
if (Test-Path 'C:\Users\stuar\Projects\fairway_sniper\agent\agent_detached.pid') {
  $agentPid = Get-Content 'C:\Users\stuar\Projects\fairway_sniper\agent\agent_detached.pid' | Select-Object -First 1
  if ($agentPid -and (Get-Process -Id $agentPid -ErrorAction SilentlyContinue)) {
    Write-Host "Stopping agent PID $agentPid" -ForegroundColor Yellow
    Stop-Process -Id $agentPid -Force
  } else { Write-Host "No running agent process found." -ForegroundColor DarkGray }
  Remove-Item 'C:\Users\stuar\Projects\fairway_sniper\agent\agent_detached.pid' -Force -ErrorAction SilentlyContinue
} else { Write-Host "PID file not found." -ForegroundColor DarkGray }
