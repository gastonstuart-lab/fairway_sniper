# Test the agent's booking logic in DRY_RUN mode
# This script creates a test job in Firestore and triggers the agent

Write-Host "=== Fairway Sniper Booking Test (DRY RUN) ===" -ForegroundColor Cyan
Write-Host ""

# Change to agent directory
$agentDir = $PSScriptRoot
Set-Location -Path $agentDir

Write-Host "This test will:" -ForegroundColor Yellow
Write-Host "  1. Run the agent with DRY_RUN mode enabled" -ForegroundColor Gray
Write-Host "  2. Use credentials from .env file" -ForegroundColor Gray
Write-Host "  3. Navigate to the tee sheet for Saturday" -ForegroundColor Gray
Write-Host "  4. Detect Book buttons without clicking them" -ForegroundColor Gray
Write-Host ""

# Check if .env exists
if (-not (Test-Path ".env")) {
    Write-Host "❌ No .env file found" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please create .env file with your credentials:" -ForegroundColor Yellow
    Write-Host "  BRS_USERNAME=your_username" -ForegroundColor Gray
    Write-Host "  BRS_PASSWORD=your_password" -ForegroundColor Gray
    Write-Host ""
    Write-Host "You can copy .env.example to .env and fill in your details" -ForegroundColor Yellow
    exit 1
}

Write-Host "✅ Found .env file" -ForegroundColor Green
Write-Host ""

# Set DRY_RUN mode
$env:DRY_RUN = "true"
$env:AGENT_RUN_MAIN = "true"

Write-Host "Starting agent in DRY_RUN mode..." -ForegroundColor Yellow
Write-Host "Press Ctrl+C to stop if it hangs" -ForegroundColor Gray
Write-Host ""

# Run the agent
# Note: In DRY_RUN mode, the agent will look for an active job in Firestore
# If no job exists, it will exit gracefully
node .\index.js --dry-run

Write-Host ""
Write-Host "=== Test Complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "If you saw 'No active jobs', that's expected without a job in Firestore." -ForegroundColor Yellow
Write-Host "To create a test job:" -ForegroundColor Yellow
Write-Host "  1. Run the Flutter app: cd .. && flutter run -d chrome" -ForegroundColor Gray
Write-Host "  2. Create a booking job in the app" -ForegroundColor Gray
Write-Host "  3. Run this test script again" -ForegroundColor Gray
