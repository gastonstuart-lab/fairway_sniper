# RELEASE_SNIPE_LIVE.ps1
# Live release-snipe validation for Fairway Sniper agent (requires -LiveConfirm)

param(
    [string]$targetDate = $(Get-Date -Format 'yyyy-MM-dd'),
    [string[]]$preferredTimes = @("07:20", "07:30"),
    [int]$windowMinutes = 2,
    [int]$fireDelaySeconds = 60,
    [switch]$LiveConfirm,
    [int]$TimeoutSec = 180
)

$BaseUrl = "http://127.0.0.1:3000"

if (-not $LiveConfirm) {
    Write-Host "[FAIL] You must pass -LiveConfirm to run a live booking."
    exit 2
}

Write-Host "[PRESET] targetDate: $targetDate"
Write-Host "[PRESET] preferredTimes: $($preferredTimes -join ', ')"
Write-Host "[PRESET] windowMinutes: $windowMinutes"
Write-Host "[PRESET] fireDelaySeconds: $fireDelaySeconds"
Write-Host "[PRESET] dryRun: false"

# The rest of the script would be identical to RELEASE_SNIPE_VERIFICATION.ps1, but with dryRun = $false
