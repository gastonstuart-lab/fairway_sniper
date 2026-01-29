# PowerShell script to test /api/fetch-tee-times-range
param(
    [string]$StartDate = $(Get-Date -Format 'yyyy-MM-dd'),
    [int]$Days = 3
)

# Prompt for credentials
$username = Read-Host -Prompt "Enter BRS username"
$password = Read-Host -Prompt "Enter BRS password" -AsSecureString
$plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
)

# Build JSON body
$body = @{ startDate = $StartDate; days = $Days; username = $username; password = $plainPassword } | ConvertTo-Json

Write-Host "\nRequesting tee times from $StartDate for $Days days..."

# Send POST request
$response = Invoke-RestMethod -Uri "http://localhost:3000/api/fetch-tee-times-range" -Method Post -ContentType "application/json" -Body $body

# Print response
$response | ConvertTo-Json -Depth 10 | Write-Host
