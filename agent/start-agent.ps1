# Start the Fairway Sniper Agent HTTP server
# Run this in a PowerShell window and leave it running

Write-Host "Starting Fairway Sniper Agent..." -ForegroundColor Cyan
Write-Host ""

# Set environment variables
$env:AGENT_RUN_MAIN = "false"
$env:NODE_ENV = "development"

# Change to agent directory
Set-Location -Path $PSScriptRoot

# Start the agent
Write-Host "Starting agent HTTP server (press Ctrl+C to stop)..." -ForegroundColor Yellow
Write-Host ""

node .\index.js

Write-Host ""
Write-Host "Agent stopped." -ForegroundColor Red
