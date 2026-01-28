# Test script for player directory endpoint
# Replace these with your actual BRS credentials

$body = @{
    username = "YOUR_USERNAME"
    password = "YOUR_PASSWORD"
    club = "YOUR_CLUB_GUI"
    debug = $true
    headed = $false
} | ConvertTo-Json

Write-Host "Testing player directory endpoint..."
Write-Host "URL: http://localhost:3000/api/brs/fetch-player-directory"
Write-Host ""

try {
    $response = Invoke-RestMethod -Uri "http://localhost:3000/api/brs/fetch-player-directory" `
        -Method Post `
        -ContentType "application/json" `
        -Body $body

    Write-Host "✓ Success!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Generated At: $($response.generatedAt)"
    Write-Host "Categories Found: $($response.categories.Count)"
    Write-Host ""

    foreach ($category in $response.categories) {
        Write-Host "Category: $($category.name)" -ForegroundColor Cyan
        Write-Host "  Players: $($category.players.Count)"
        
        # Show first 5 players as sample
        $sample = $category.players | Select-Object -First 5
        foreach ($player in $sample) {
            Write-Host "    - $($player.name) (ID: $($player.id), Type: $($player.type))"
        }
        
        if ($category.players.Count -gt 5) {
            Write-Host "    ... and $($category.players.Count - 5) more"
        }
        Write-Host ""
    }

    Write-Host "Full response:"
    $response | ConvertTo-Json -Depth 10

} catch {
    Write-Host "✗ Error!" -ForegroundColor Red
    Write-Host $_.Exception.Message
    if ($_.ErrorDetails) {
        Write-Host $_.ErrorDetails.Message
    }
}
