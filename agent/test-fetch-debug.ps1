# Test fetch-tee-times endpoint with debug logging
Write-Host "Loading credentials from .env..."
Get-Content .env | ForEach-Object {
    if($_ -match '^([^=]+)=(.*)$') {
        Set-Item -Path "env:$($matches[1])" -Value $matches[2]
    }
}

$tomorrow = (Get-Date).AddDays(1).ToString('yyyy-MM-dd')
Write-Host "`nTesting fetch for date: $tomorrow"
Write-Host "Username: $env:BRS_USERNAME"

$body = @{
    date = $tomorrow
    username = $env:BRS_USERNAME
    password = $env:BRS_PASSWORD
    club = 'galgorm'
    debug = $true
} | ConvertTo-Json

Write-Host "`nSending request to agent..."
try {
    $result = Invoke-RestMethod -Uri 'http://localhost:3000/api/fetch-tee-times' -Method POST -Body $body -ContentType 'application/json'
    Write-Host "`n=== RESULT ===" -ForegroundColor Green
    $result | ConvertTo-Json -Depth 5
} catch {
    Write-Host "`nERROR: $_" -ForegroundColor Red
    Write-Host $_.Exception.Response
}
