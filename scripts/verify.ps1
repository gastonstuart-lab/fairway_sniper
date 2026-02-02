# scripts/verify.ps1
# Starts the agent, checks /api/health, then stops the agent cleanly.

$ErrorActionPreference = 'Stop'

Write-Host "[VERIFY] Starting agent in background..."
$agent = Start-Process -FilePath "node" -ArgumentList "agent/index.js" -PassThru
Start-Sleep -Seconds 5

Write-Host "[VERIFY] Checking /api/health..."
try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:3000/api/health" -UseBasicParsing -TimeoutSec 10
    Write-Host "[VERIFY] /api/health response: $($response.StatusCode)"
    Write-Host $response.Content
} catch {
    Write-Host "[VERIFY] ERROR: Could not reach /api/health."
    throw
}

Write-Host "[VERIFY] Stopping agent..."
Stop-Process -Id $agent.Id -Force
Write-Host "[VERIFY] Agent stopped."
