# PowerShell script to test /api/fetch-tee-times
param()

# Prompt for credentials
$username = Read-Host -Prompt "Enter BRS username"
$password = Read-Host -Prompt "Enter BRS password" -AsSecureString
$plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
)

# Prompt for date (default to today)
$date = Read-Host -Prompt "Enter date (YYYY-MM-DD, blank for today)"
if ([string]::IsNullOrWhiteSpace($date)) {
    $date = (Get-Date -Format 'yyyy-MM-dd')
}

# Build JSON body
$body = @{ date = $date; username = $username; password = $plainPassword } | ConvertTo-Json

# Send POST request
$response = Invoke-RestMethod -Uri "http://localhost:3000/api/fetch-tee-times" -Method Post -ContentType "application/json" -Body $body

# Print response
$response | ConvertTo-Json -Depth 10 | Write-Host
