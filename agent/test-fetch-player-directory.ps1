# PowerShell script to test /api/brs/fetch-player-directory
param(
    [string]$Username = "12390624",
    [string]$Password = "cantona7777"
)

# Build JSON body
$body = @{ username = $Username; password = $Password } | ConvertTo-Json

Write-Host "\nRequesting player directory for $Username..."

# Send POST request (wizard endpoint)
$response = Invoke-RestMethod -Uri "http://localhost:3000/api/brs/player-directory" -Method Post -ContentType "application/json" -Body $body

# Print response
$response | ConvertTo-Json -Depth 10 | Write-Host

# Simple validation (count >> 1)
if ($response.count -le 1) {
    throw "Player directory count too low: $($response.count)"
}
