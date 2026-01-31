# agent/scripts/verify-health.ps1
# Verifies the health endpoint of the agent

$BaseUrl = "http://127.0.0.1:3000"
Write-Host "[VERIFY] Current Directory: $PWD"
Write-Host "[VERIFY] Expected Directory: agent"

if (-not ($PWD.Path -like "*\agent")) {
    Write-Host "[ERROR] Run this script from the agent directory."
    exit 1
}

try {
    $response = Invoke-WebRequest -Uri "$BaseUrl/api/health" -UseBasicParsing -TimeoutSec 10
    if ($response.StatusCode -eq 200) {
        Write-Host "[PASS] /api/health responded with 200 OK"
        exit 0
    } else {
        Write-Host "[FAIL] /api/health responded with $($response.StatusCode)"
        exit 2
    }
} catch {
    Write-Host "[FAIL] /api/health not reachable."
    exit 2
}
