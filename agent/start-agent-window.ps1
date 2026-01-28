# Start Fairway Sniper Agent in a new PowerShell window
# This keeps the agent running independently of VS Code

$agentPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$scriptBlock = @"
Set-Location '$agentPath'
Write-Host '═══════════════════════════════════════════════════════════' -ForegroundColor Cyan
Write-Host '  FAIRWAY SNIPER AGENT SERVER' -ForegroundColor Cyan
Write-Host '═══════════════════════════════════════════════════════════' -ForegroundColor Cyan
Write-Host ''
Write-Host 'Starting agent server...' -ForegroundColor Yellow
Write-Host ''

node index.js

Write-Host ''
Write-Host 'Agent server stopped.' -ForegroundColor Red
Write-Host 'Press any key to close this window...'
`$null = `$Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
"@

# Start new PowerShell window with the agent
Start-Process powershell -ArgumentList "-NoExit", "-Command", $scriptBlock

Write-Host ""
Write-Host "✅ Agent server launched in new window!" -ForegroundColor Green
Write-Host ""
Write-Host "The agent server is now running at: http://localhost:3000" -ForegroundColor Cyan
Write-Host ""
Write-Host "To test it, run:" -ForegroundColor Yellow
Write-Host "  Invoke-RestMethod -Uri 'http://localhost:3000/api/health'" -ForegroundColor White
Write-Host ""
Write-Host "To stop the agent, close the PowerShell window or press Ctrl+C in it." -ForegroundColor Gray
Write-Host ""
