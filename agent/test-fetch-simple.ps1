# Simple test to fetch tee times from agent
$body = @{
    date = (Get-Date).AddDays(1).ToString("yyyy-MM-ddT00:00:00")
    username = "12390624"
    password = (Get-Content "agent\.secrets\brs_password.txt" -Raw).Trim()
    club = "galgorm"
    debug = $true
} | ConvertTo-Json

Write-Host "Sending request to agent..."
Write-Host "Date: $(($body | ConvertFrom-Json).date)"

try {
    $response = Invoke-WebRequest -Uri "http://localhost:3000/api/fetch-tee-times" `
        -Method POST `
        -Body $body `
        -ContentType "application/json" `
        -UseBasicParsing `
        -TimeoutSec 60
    
    Write-Host "`nResponse Status: $($response.StatusCode)"
    Write-Host "Response Body:"
    $response.Content | ConvertFrom-Json | ConvertTo-Json -Depth 10
} catch {
    Write-Host "Error: $_"
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $reader.BaseStream.Position = 0
        $reader.DiscardBufferedData()
        Write-Host "Response: $($reader.ReadToEnd())"
    }
}
