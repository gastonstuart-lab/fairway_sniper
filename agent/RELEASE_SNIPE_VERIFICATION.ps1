# RELEASE_SNIPE_VERIFICATION.ps1

param(
    [string]$targetDate = $(Get-Date -Format 'yyyy-MM-dd'),
    [string[]]$preferredTimes = @("07:20", "07:30"),
    [int]$windowMinutes = 2,
    [int]$fireDelaySeconds = 60,
    [int]$TimeoutSec = 180
)

$BaseUrl = "http://127.0.0.1:3000"

Write-Host "[PRESET] targetDate: $targetDate"
Write-Host "[PRESET] preferredTimes: $($preferredTimes -join ', ')"
Write-Host "[PRESET] windowMinutes: $windowMinutes"
Write-Host "[PRESET] fireDelaySeconds: $fireDelaySeconds"
Write-Host "[PRESET] dryRun: true"

Write-Host "[VERIFY] Checking /api/health..."
try {
    $health = Invoke-WebRequest -Uri "$BaseUrl/api/health" -UseBasicParsing -TimeoutSec 5
    if ($health.StatusCode -ne 200) {
        Write-Host "[FAIL] /api/health not OK: $($health.StatusCode)"
        exit 2
    }
} catch {
    Write-Host "[FAIL] /api/health unreachable."
    exit 2
}

Write-Host "[VERIFY] Calling /api/warm-ensure..."
try {
    $warm = Invoke-WebRequest -Uri "$BaseUrl/api/warm-ensure" -Method Post -Body (@{ username = "test"; password = "test"; targetDate = (Get-Date).ToString('yyyy-MM-dd') } | ConvertTo-Json) -ContentType 'application/json' -UseBasicParsing -TimeoutSec 10
    Write-Host "[VERIFY] /api/warm-ensure: $($warm.StatusCode)"
} catch {
    Write-Host "[FAIL] /api/warm-ensure failed."
    exit 2
}

Write-Host "[VERIFY] POST /api/release-snipe (dryRun)..."
try {
    $body = @{ dryRun = $true; preferredTimes = $PreferredTimes } | ConvertTo-Json
    $release = Invoke-WebRequest -Uri "$BaseUrl/api/release-snipe" -Method Post -Body $body -ContentType 'application/json' -UseBasicParsing -TimeoutSec 10
    $releaseJson = $release.Content | ConvertFrom-Json
    $runId = $releaseJson.runId
    if (-not $runId) {
        Write-Host "[FAIL] No runId returned from /api/release-snipe."
        exit 2
    }
    Write-Host "[VERIFY] Got runId: $runId"
} catch {
    Write-Host "[FAIL] /api/release-snipe failed."
    exit 2
}

Write-Host "[VERIFY] Polling /api/release-snipe/$runId ..."
$elapsed = 0
$interval = 2
$max = $TimeoutSec
$state = ""
while ($elapsed -lt $max) {
    try {
        $status = Invoke-WebRequest -Uri "$BaseUrl/api/release-snipe/$runId" -UseBasicParsing -TimeoutSec 10
        $statusJson = $status.Content | ConvertFrom-Json
        $state = $statusJson.state
        if ($state -eq "finished") {
            Write-Host "[PASS] Release-snipe finished."
            break
        } elseif ($state -eq "error") {
            Write-Host "[FAIL] Release-snipe error: $($statusJson.error)"
            exit 2
        }
    } catch {
        Write-Host "[FAIL] Polling failed."
        exit 2
    }
    Start-Sleep -Seconds $interval
    $elapsed += $interval
}
if ($state -ne "finished") {
    Write-Host "[FAIL] Release-snipe did not finish in $TimeoutSec seconds."
    exit 2
}

Write-Host "[VERIFY] Checking audit log for runId..."
try {
    $audit = Invoke-WebRequest -Uri "$BaseUrl/api/audit-tail?lines=50" -UseBasicParsing -TimeoutSec 10
    $auditJson = $audit.Content | ConvertFrom-Json
    $found = $false
    foreach ($line in $auditJson.lines) {
        if ($line.runId -eq $runId) { $found = $true; break }
    }
    if ($found) {
        Write-Host "[PASS] runId $runId found in audit log."
        exit 0
    } else {
        Write-Host "[FAIL] runId $runId NOT found in audit log."
        exit 2
    }
} catch {
    Write-Host "[FAIL] Audit log check failed."
    exit 2
}
