# Fairway Sniper - Complete Startup Script
# Starts the agent in a persistent PowerShell window

Write-Host "`n" -NoNewline
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "         🎯 FAIRWAY SNIPER - AGENT STARTUP 🎯             " -ForegroundColor Cyan  
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

$agentPath = "C:\Users\stuar\Projects\fairway_sniper\agent"

# Check if node is available
try {
    $nodeVersion = node --version
    Write-Host "✅ Node.js detected: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Node.js not found! Please install Node.js first." -ForegroundColor Red
    exit 1
}

# Check if agent directory exists
if (!(Test-Path $agentPath)) {
    Write-Host "❌ Agent directory not found: $agentPath" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Agent directory found" -ForegroundColor Green

# Check for existing node processes on port 3000
$existingProcess = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if ($existingProcess) {
    Write-Host "⚠️  Port 3000 is already in use!" -ForegroundColor Yellow
    Write-Host "   Attempting to kill existing process..." -ForegroundColor Yellow
    Get-Process -Id $existingProcess.OwningProcess -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 2
}

Write-Host ""
Write-Host "🚀 Starting Fairway Sniper Agent..." -ForegroundColor Cyan
Write-Host "   The agent will open in a new PowerShell window" -ForegroundColor Gray
Write-Host "   Keep that window open while using the app" -ForegroundColor Gray
Write-Host ""

# Start the agent in a new persistent PowerShell window
Start-Process powershell -ArgumentList `
    "-NoExit", `
    "-Command", `
    "cd '$agentPath'; Write-Host '🎯 Fairway Sniper Agent' -ForegroundColor Cyan; Write-Host 'Keep this window open' -ForegroundColor Yellow; Write-Host ''; node index.js"

# Wait for server to start
Write-Host "⏳ Waiting for server to start..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# Test the connection
try {
    $health = Invoke-RestMethod -Uri 'http://localhost:3000/api/health' -TimeoutSec 5
    Write-Host "✅ Agent is running successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "📍 Endpoints Available:" -ForegroundColor Cyan
    Write-Host "   • Health: http://localhost:3000/api/health" -ForegroundColor White
    Write-Host "   • Fetch Tee Times: POST http://localhost:3000/api/fetch-tee-times" -ForegroundColor White
    Write-Host ""
    Write-Host "🎯 Next Steps:" -ForegroundColor Cyan
    Write-Host "   1. Keep the agent window open" -ForegroundColor White
    Write-Host "   2. Run: flutter run -d chrome" -ForegroundColor White
    Write-Host "   3. Create your first booking job!" -ForegroundColor White
    Write-Host ""
} catch {
    Write-Host "❌ Agent failed to start properly" -ForegroundColor Red
    Write-Host "   Error: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "💡 Troubleshooting:" -ForegroundColor Yellow
    Write-Host "   • Check the agent window for errors" -ForegroundColor White
    Write-Host "   • Ensure port 3000 is not blocked by firewall" -ForegroundColor White
    Write-Host "   • Try running: cd agent; node index.js" -ForegroundColor White
    exit 1
}

Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
