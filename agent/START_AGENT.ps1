# Fairway Sniper Agent Starter
# This script starts the HTTP server on port 3000

Write-Host "`n🚀 Starting Fairway Sniper Agent..." -ForegroundColor Cyan
Write-Host "   Press Ctrl+C to stop the server`n" -ForegroundColor Yellow

# Set to agent directory
Push-Location $PSScriptRoot

# Set environment
$env:AGENT_RUN_MAIN = 'false'
$env:NODE_ENV = 'production'
$env:PORT = '3000'

Write-Host "📂 Working directory: $(Get-Location)" -ForegroundColor Gray
Write-Host "🔧 Starting Node.js server...`n" -ForegroundColor Gray

# Start the server
try {
    node index.js
} catch {
    Write-Host "`n❌ Error starting server: $_" -ForegroundColor Red
    Pop-Location
    exit 1
}

Pop-Location
